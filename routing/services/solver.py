"""Solveurs OR-Tools pour TSP et Pickup & Delivery."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from ortools.constraint_solver import pywrapcp, routing_enums_pb2

from routing.services.distance import build_distance_matrix
from routing.services.osrm import (
    OsrmError,
    durations_to_minutes,
    fetch_route_details,
    fetch_table,
)

ProblemType = Literal['tsp', 'pdp']
DEFAULT_SPEED_KMH = 30
DEFAULT_SERVICE_TIME_MIN = 2
DEFAULT_MAX_ROUTE_TIME_MIN = 480
DEFAULT_WAITING_SLACK_MIN = 30


@dataclass
class RouteResult:
    vehicle_id: int
    node_indices: list[int]
    distance: int
    load: int = 0
    arrival_times: list[tuple[int, int]] = field(default_factory=list)
    geometry: list[list[float]] = field(default_factory=list)
    duration_minutes: int = 0


@dataclass
class SolveResult:
    problem_type: ProblemType
    objective_value: int
    routes: list[RouteResult]
    distance_matrix: list[list[int]]
    time_matrix: list[list[int]] | None = None
    routing_engine: str = 'haversine'
    index_map: list[int] = field(default_factory=list)


class RoutingSolverError(Exception):
    """Erreur métier lors de la résolution d'une tournée."""


def meters_to_minutes(distance_m: int, speed_kmh: float = DEFAULT_SPEED_KMH) -> int:
    speed = speed_kmh if speed_kmh > 0 else DEFAULT_SPEED_KMH
    meters_per_minute = speed * 1000 / 60
    return max(1, int(round(distance_m / meters_per_minute)))


def build_time_matrix(distance_matrix: list[list[int]], speed_kmh: float) -> list[list[int]]:
    size = len(distance_matrix)
    return [
        [
            meters_to_minutes(distance_matrix[i][j], speed_kmh) if i != j else 0
            for j in range(size)
        ]
        for i in range(size)
    ]


def expand_shared_deliveries(
    points: list[dict],
    pairs: list[list[int]],
) -> tuple[list[dict], list[list[int]], list[int]]:
    """Donne à chaque ramassage sa propre arrivée à l'école.

    OR-Tools ne peut visiter un nœud qu'une fois. Si plusieurs ramassages
    partagent la même école, un seul bus pourrait y déposer. Une copie de
    l'école par ramassage supplémentaire permet à chaque bus d'y passer.
    """
    expanded = [dict(point) for point in points]
    index_map = list(range(len(points)))
    used_deliveries: set[int] = set()
    remapped: list[list[int]] = []

    for pickup_node, delivery_node in pairs:
        target = delivery_node
        if delivery_node in used_deliveries:
            expanded.append(dict(points[delivery_node]))
            target = len(expanded) - 1
            index_map.append(delivery_node)
        else:
            used_deliveries.add(delivery_node)
        remapped.append([pickup_node, target])

    return expanded, remapped, index_map


def capacity_can_cover(
    points: list[dict],
    pairs: list[list[int]] | None,
    vehicle_capacities: list[int],
) -> bool:
    """Vrai si aucun groupe ni le total ne dépasse les places des bus."""
    if not vehicle_capacities:
        return True
    per_bus = max(vehicle_capacities)
    total = 0
    if pairs:
        amounts = [
            int(points[pickup_node].get('demand', 1) or 1)
            for pickup_node, _delivery in pairs
        ]
    else:
        amounts = [
            int(point.get('demand', 1) or 1)
            for point in points
            if point.get('type') == 'pickup'
        ]
    for amount in amounts:
        if amount > per_bus:
            return False
        total += amount
    return total <= sum(vehicle_capacities)


def collapse_route_nodes(
    node_indices: list[int],
    arrival_times: list[tuple[int, int]],
    index_map: list[int],
) -> tuple[list[int], list[tuple[int, int]]]:
    """Replie les copies d'une même école visitées d'affilée."""
    collapsed_nodes: list[int] = []
    collapsed_times: list[tuple[int, int]] = []
    for position, node_index in enumerate(node_indices):
        if index_map and 0 <= node_index < len(index_map):
            original = index_map[node_index]
        else:
            original = index_map[0] if index_map else node_index
        if collapsed_nodes and collapsed_nodes[-1] == original:
            continue
        collapsed_nodes.append(original)
        if arrival_times and position < len(arrival_times):
            collapsed_times.append(arrival_times[position])
    return collapsed_nodes, collapsed_times


def build_demands(
    num_nodes: int,
    points: list[dict],
    pickups_deliveries: list[list[int]] | None,
) -> list[int]:
    """Demande nette par nœud : +élèves au ramassage, −élèves à l'école."""
    demands = [0] * num_nodes
    if not pickups_deliveries:
        for index, point in enumerate(points):
            if point.get('type') == 'pickup':
                demands[index] = point.get('demand', 1)
        return demands

    for pickup_node, delivery_node in pickups_deliveries:
        amount = points[pickup_node].get('demand', 1)
        demands[pickup_node] += amount
        demands[delivery_node] -= amount
    return demands


def build_time_windows(points: list[dict]) -> list[tuple[int, int] | None]:
    windows: list[tuple[int, int] | None] = []
    for point in points:
        start = point.get('time_window_start')
        end = point.get('time_window_end')
        if start is not None and end is not None:
            windows.append((int(start), int(end)))
        else:
            windows.append(None)
    return windows


def compute_route_duration_minutes(
    node_indices: list[int],
    time_matrix: list[list[int]],
    service_time: int,
    arrival_times: list[tuple[int, int]] | None = None,
    duration_seconds: int | None = None,
) -> int:
    """Durée totale de la tournée en minutes."""
    if arrival_times and len(arrival_times) >= 2:
        return max(0, arrival_times[-1][0] - arrival_times[0][0])

    if duration_seconds is not None and duration_seconds > 0:
        return max(1, int(round(duration_seconds / 60)))

    if len(node_indices) < 2:
        return 0

    total = 0
    for i in range(len(node_indices) - 1):
        from_node = node_indices[i]
        to_node = node_indices[i + 1]
        total += time_matrix[from_node][to_node]
        total += service_time
    return max(1, total)


def solve_routing(
    points: list[dict],
    *,
    problem_type: ProblemType = 'tsp',
    num_vehicles: int = 1,
    depot_index: int = 0,
    pickups_deliveries: list[list[int]] | None = None,
    max_distance: int = 1_000_000,
    vehicle_capacities: list[int] | None = None,
    use_time_windows: bool = False,
    max_route_time: int = DEFAULT_MAX_ROUTE_TIME_MIN,
    waiting_slack: int = DEFAULT_WAITING_SLACK_MIN,
    service_time: int = DEFAULT_SERVICE_TIME_MIN,
    average_speed_kmh: float = DEFAULT_SPEED_KMH,
    use_road_routing: bool = False,
    osrm_base_url: str | None = None,
) -> SolveResult:
    if len(points) < 2:
        raise RoutingSolverError('Au moins 2 points sont requis.')

    if depot_index < 0 or depot_index >= len(points):
        raise RoutingSolverError('Index de dépôt invalide.')

    if num_vehicles < 1:
        raise RoutingSolverError('Le nombre de véhicules doit être >= 1.')

    original_points = points
    original_pairs = pickups_deliveries
    if problem_type == 'pdp' and pickups_deliveries:
        points, pickups_deliveries, index_map = expand_shared_deliveries(
            points,
            pickups_deliveries,
        )
    else:
        index_map = list(range(len(points)))

    distance_matrix = build_distance_matrix(points)
    time_matrix = build_time_matrix(distance_matrix, average_speed_kmh)
    routing_engine = 'haversine'

    if use_road_routing:
        if not osrm_base_url:
            raise RoutingSolverError('URL OSRM non configurée (OSRM_BASE_URL).')
        try:
            distance_matrix, duration_matrix = fetch_table(points, base_url=osrm_base_url)
            time_matrix = durations_to_minutes(duration_matrix)
            routing_engine = 'osrm'
        except OsrmError as exc:
            raise RoutingSolverError(str(exc)) from exc

    time_windows = build_time_windows(points)
    has_time_windows = use_time_windows and any(window is not None for window in time_windows)
    has_capacity = vehicle_capacities is not None and len(vehicle_capacities) > 0

    if has_capacity and len(vehicle_capacities) != num_vehicles:
        raise RoutingSolverError(
            'Le nombre de capacités véhicule doit correspondre au nombre de véhicules.'
        )

    manager = pywrapcp.RoutingIndexManager(
        len(distance_matrix),
        num_vehicles,
        depot_index,
    )
    routing = pywrapcp.RoutingModel(manager)

    def distance_callback(from_index: int, to_index: int) -> int:
        from_node = manager.IndexToNode(from_index)
        to_node = manager.IndexToNode(to_index)
        return distance_matrix[from_node][to_node]

    transit_callback_index = routing.RegisterTransitCallback(distance_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)

    dimension_name = 'Distance'
    routing.AddDimension(
        transit_callback_index,
        0,
        max_distance,
        True,
        dimension_name,
    )
    distance_dimension = routing.GetDimensionOrDie(dimension_name)
    distance_dimension.SetGlobalSpanCostCoefficient(100)

    time_dimension = None
    if has_time_windows:

        def time_callback(from_index: int, to_index: int) -> int:
            from_node = manager.IndexToNode(from_index)
            to_node = manager.IndexToNode(to_index)
            return time_matrix[from_node][to_node] + service_time

        time_callback_index = routing.RegisterTransitCallback(time_callback)
        routing.AddDimension(
            time_callback_index,
            waiting_slack,
            max_route_time,
            False,
            'Time',
        )
        time_dimension = routing.GetDimensionOrDie('Time')

        depot_window = time_windows[depot_index]
        for vehicle_id in range(num_vehicles):
            start_index = routing.Start(vehicle_id)
            if depot_window:
                time_dimension.CumulVar(start_index).SetRange(depot_window[0], depot_window[1])
            routing.AddVariableMinimizedByFinalizer(
                time_dimension.CumulVar(routing.Start(vehicle_id))
            )
            routing.AddVariableMinimizedByFinalizer(
                time_dimension.CumulVar(routing.End(vehicle_id))
            )

        for location_idx, window in enumerate(time_windows):
            if window is None:
                continue
            index = manager.NodeToIndex(location_idx)
            time_dimension.CumulVar(index).SetRange(window[0], window[1])

    if has_capacity:
        demands = build_demands(len(points), points, pickups_deliveries)

        def demand_callback(from_index: int) -> int:
            from_node = manager.IndexToNode(from_index)
            return demands[from_node]

        demand_callback_index = routing.RegisterUnaryTransitCallback(demand_callback)
        routing.AddDimensionWithVehicleCapacity(
            demand_callback_index,
            0,
            vehicle_capacities,
            True,
            'Capacity',
        )

    if problem_type == 'pdp':
        pairs = pickups_deliveries or []
        if not pairs:
            raise RoutingSolverError(
                'Le mode Pickup & Delivery requiert des paires pickup/delivery.'
            )
        for pickup_node, delivery_node in pairs:
            if pickup_node == delivery_node:
                raise RoutingSolverError(
                    'Une paire pickup/delivery ne peut pas avoir le même nœud.'
                )
            pickup_index = manager.NodeToIndex(pickup_node)
            delivery_index = manager.NodeToIndex(delivery_node)
            routing.AddPickupAndDelivery(pickup_index, delivery_index)
            routing.solver().Add(
                routing.VehicleVar(pickup_index) == routing.VehicleVar(delivery_index)
            )
            routing.solver().Add(
                distance_dimension.CumulVar(pickup_index)
                <= distance_dimension.CumulVar(delivery_index)
            )
            if time_dimension is not None:
                routing.solver().Add(
                    time_dimension.CumulVar(pickup_index)
                    <= time_dimension.CumulVar(delivery_index)
                )

    search_parameters = pywrapcp.DefaultRoutingSearchParameters()
    if problem_type == 'pdp' or has_capacity or has_time_windows:
        search_parameters.first_solution_strategy = (
            routing_enums_pb2.FirstSolutionStrategy.PARALLEL_CHEAPEST_INSERTION
        )
        search_parameters.local_search_metaheuristic = (
            routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
        )
        search_parameters.time_limit.FromSeconds(5)
    else:
        search_parameters.first_solution_strategy = (
            routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
        )

    solution = routing.SolveWithParameters(search_parameters)
    if not solution:
        hints = []
        if has_capacity and not capacity_can_cover(
            original_points,
            original_pairs,
            vehicle_capacities or [],
        ):
            hints.append('capacité bus insuffisante')
        if has_time_windows:
            hints.append('fenêtres horaires incompatibles')
        if problem_type == 'pdp':
            hints.append('contraintes ramassage → école')
        detail = ', '.join(hints) if hints else 'contraintes du problème'
        raise RoutingSolverError(f'Aucune solution trouvée. Vérifiez : {detail}.')

    capacity_dimension = routing.GetDimensionOrDie('Capacity') if has_capacity else None

    routes: list[RouteResult] = []
    for vehicle_id in range(num_vehicles):
        index = routing.Start(vehicle_id)
        node_indices: list[int] = []
        arrival_times: list[tuple[int, int]] = []
        route_distance = 0
        route_load = 0

        while not routing.IsEnd(index):
            node_index = manager.IndexToNode(index)
            node_indices.append(node_index)

            if time_dimension is not None:
                time_var = time_dimension.CumulVar(index)
                arrival_times.append(
                    (solution.Min(time_var), solution.Max(time_var))
                )

            if capacity_dimension is not None:
                route_load = solution.Value(capacity_dimension.CumulVar(index))

            previous_index = index
            index = solution.Value(routing.NextVar(index))
            route_distance += routing.GetArcCostForVehicle(
                previous_index, index, vehicle_id
            )

        final_node = manager.IndexToNode(index)
        node_indices.append(final_node)

        if time_dimension is not None:
            time_var = time_dimension.CumulVar(index)
            arrival_times.append((solution.Min(time_var), solution.Max(time_var)))

        node_indices, arrival_times = collapse_route_nodes(
            node_indices,
            arrival_times,
            index_map,
        )

        if len(node_indices) > 1 or num_vehicles == 1:
            route_geometry: list[list[float]] = []
            route_duration_seconds: int | None = None
            if use_road_routing and osrm_base_url and len(node_indices) >= 2:
                ordered_points = [points[node_index] for node_index in node_indices]
                try:
                    route_geometry, route_duration_seconds = fetch_route_details(
                        ordered_points,
                        base_url=osrm_base_url,
                    )
                except OsrmError:
                    route_geometry = [
                        [points[node_index]['lat'], points[node_index]['lng']]
                        for node_index in node_indices
                    ]

            duration_minutes = compute_route_duration_minutes(
                node_indices,
                time_matrix,
                service_time,
                arrival_times=arrival_times if time_dimension is not None else None,
                duration_seconds=route_duration_seconds,
            )

            routes.append(
                RouteResult(
                    vehicle_id=vehicle_id,
                    node_indices=node_indices,
                    distance=route_distance,
                    load=route_load,
                    arrival_times=arrival_times,
                    geometry=route_geometry,
                    duration_minutes=duration_minutes,
                )
            )

    return SolveResult(
        problem_type=problem_type,
        objective_value=int(solution.ObjectiveValue()),
        routes=routes,
        distance_matrix=distance_matrix,
        time_matrix=time_matrix if has_time_windows else None,
        routing_engine=routing_engine,
        index_map=index_map,
    )
