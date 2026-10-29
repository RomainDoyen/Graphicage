import json
import uuid
from pathlib import Path

from django.conf import settings
from django.db.models import Q
from django.http import Http404
from django.utils.text import slugify
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from routing.auth_views import save_route_history
from routing.models import CatalogPoint, SavedScenario
from routing.serializers import (
    GeocodeRequestSerializer,
    SavedScenarioSerializer,
    SavedScenarioUpdateSerializer,
    SolveRequestSerializer,
)
from routing.services.geocoding import GeocodingError, geocode_address
from routing.services.places import PlacesError, search_places
from routing.services.solver import RoutingSolverError, solve_routing


def format_minutes_as_time(minutes: int) -> str:
    hours = minutes // 60
    mins = minutes % 60
    return f'{hours:02d}:{mins:02d}'


def format_duration_minutes(minutes: int) -> str:
    """Format lisible : « 1 h 23 min » ou « 45 min »."""
    if minutes <= 0:
        return '0 min'
    hours = minutes // 60
    mins = minutes % 60
    if hours > 0:
        return f'{hours} h {mins:02d} min'
    return f'{mins} min'


def build_route_summary(routes: list) -> dict:
    total_distance = sum(route.distance for route in routes)
    total_duration = sum(route.duration_minutes for route in routes)
    total_stops = sum(len(route.node_indices) for route in routes)
    max_load = max((route.load for route in routes), default=0)
    distance_km = total_distance / 1000
    fuel_liters = round(distance_km * 0.35, 1)
    co2_kg = round(fuel_liters * 2.68, 1)
    return {
        'total_distance_meters': total_distance,
        'total_distance_label': format_distance_meters(total_distance),
        'total_duration_minutes': total_duration,
        'total_duration_label': format_duration_minutes(total_duration),
        'total_stops': total_stops,
        'vehicle_count': len(routes),
        'max_load': max_load,
        'fuel_liters_estimate': fuel_liters,
        'co2_kg_estimate': co2_kg,
    }


def format_distance_meters(meters: int) -> str:
    if meters >= 1000:
        return f'{meters / 1000:.2f} km'
    return f'{meters} m'


def scenario_to_dict(scenario: SavedScenario) -> dict:
    return {
        'id': scenario.id,
        'slug': scenario.slug,
        'name': scenario.name,
        'config': scenario.config,
        'points': scenario.points,
        'baseline_result': scenario.baseline_result,
        'last_result': scenario.last_result,
        'is_public': scenario.is_public,
        'created_at': scenario.created_at.isoformat(),
        'updated_at': scenario.updated_at.isoformat(),
    }


def unique_slug(name: str) -> str:
    base = slugify(name) or 'tournee'
    return f'{base}-{uuid.uuid4().hex[:8]}'


class SampleDatasetView(APIView):
    """Retourne le jeu de données exemple (écoles / domiciles, La Réunion)."""

    def get(self, request):
        data_path = Path(settings.BASE_DIR) / 'data' / 'sample_dataset.json'
        with data_path.open(encoding='utf-8') as handle:
            payload = json.load(handle)
        return Response(payload)


class ImportTemplateView(APIView):
    """Modèle JSON minimal pour importer ses propres points."""

    def get(self, request):
        data_path = Path(settings.BASE_DIR) / 'data' / 'import_template.json'
        with data_path.open(encoding='utf-8') as handle:
            payload = json.load(handle)
        return Response(payload)


class PlaceSearchView(APIView):
    """Recherche de lieux (écoles, adresses, arrêts) via APIs publiques."""

    def get(self, request):
        query = request.query_params.get('q', '').strip()
        if len(query) < 2:
            return Response({'results': []})

        place_type = request.query_params.get('type', 'all')
        try:
            limit = int(request.query_params.get('limit', 8))
        except (TypeError, ValueError):
            limit = 8

        try:
            results = search_places(query, place_type=place_type, limit=limit)
        except PlacesError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

        return Response({'results': results})


class CatalogPointListView(APIView):
    """Lieux de référence enregistrés (admin Django / Neon)."""

    def get(self, request):
        point_type = request.query_params.get('type')
        queryset = CatalogPoint.objects.filter(is_active=True)
        if point_type and point_type != 'all':
            queryset = queryset.filter(type=point_type)
        results = [
            {
                'id': f'catalog-{point.pk}',
                'label': point.label,
                'type': point.type,
                'lat': point.lat,
                'lng': point.lng,
                'address': point.address,
                'school_label': point.school_label,
                'source': 'catalog',
            }
            for point in queryset[:100]
        ]
        return Response({'results': results})


class GeocodeView(APIView):
    """Géocodage d'une adresse (Google si clé API, sinon Nominatim)."""

    def post(self, request):
        serializer = GeocodeRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            result = geocode_address(serializer.validated_data['address'])
        except GeocodingError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        return Response(result)


class ScenarioListCreateView(APIView):
    """Liste et création de tournées enregistrées."""

    def get(self, request):
        if request.user.is_authenticated:
            scenarios = SavedScenario.objects.filter(
                Q(is_public=True) | Q(user=request.user)
            ).distinct()
        else:
            scenarios = SavedScenario.objects.filter(is_public=True)
        payload = [scenario_to_dict(s) for s in scenarios.order_by('-updated_at')[:50]]
        return Response({'scenarios': payload})

    def post(self, request):
        if not request.user.is_authenticated:
            return Response(
                {'detail': 'Connexion requise pour enregistrer une tournée.'},
                status=status.HTTP_401_UNAUTHORIZED,
            )
        serializer = SavedScenarioSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        scenario = SavedScenario.objects.create(
            user=request.user,
            name=data['name'],
            slug=unique_slug(data['name']),
            config=data.get('config', {}),
            points=data.get('points', []),
            baseline_result=data.get('baseline_result'),
            last_result=data.get('last_result'),
            is_public=data.get('is_public', False),
        )
        return Response(scenario_to_dict(scenario), status=status.HTTP_201_CREATED)


class ScenarioDetailView(APIView):
    """Charger, mettre à jour ou supprimer une tournée."""

    def _get_scenario(self, slug: str, request):
        try:
            scenario = SavedScenario.objects.get(slug=slug)
        except SavedScenario.DoesNotExist as exc:
            raise Http404 from exc
        if not scenario.is_public:
            if not request.user.is_authenticated or scenario.user_id != request.user.id:
                raise Http404
        return scenario

    def get(self, request, slug):
        scenario = self._get_scenario(slug, request)
        return Response(scenario_to_dict(scenario))

    def patch(self, request, slug):
        scenario = self._get_scenario(slug, request)
        if not request.user.is_authenticated or scenario.user_id != request.user.id:
            return Response({'detail': 'Non autorisé.'}, status=status.HTTP_403_FORBIDDEN)
        serializer = SavedScenarioUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        for field, value in serializer.validated_data.items():
            setattr(scenario, field, value)
        scenario.save()
        return Response(scenario_to_dict(scenario))

    def delete(self, request, slug):
        scenario = self._get_scenario(slug, request)
        if not request.user.is_authenticated or scenario.user_id != request.user.id:
            return Response({'detail': 'Non autorisé.'}, status=status.HTTP_403_FORBIDDEN)
        scenario.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class SolveRouteView(APIView):
    """Résout un problème TSP ou Pickup & Delivery via OR-Tools."""

    def post(self, request):
        serializer = SolveRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            result = solve_routing(
                data['points'],
                problem_type=data['problem_type'],
                num_vehicles=data['num_vehicles'],
                depot_index=data['depot_index'],
                pickups_deliveries=data.get('pickups_deliveries'),
                max_distance=data.get('max_distance', 1_000_000),
                vehicle_capacities=data.get('vehicle_capacities'),
                use_time_windows=data.get('use_time_windows', False),
                max_route_time=data.get('max_route_time', 480),
                waiting_slack=data.get('waiting_slack', 30),
                service_time=data.get('service_time', 2),
                average_speed_kmh=data.get('average_speed_kmh', 30),
                use_road_routing=data.get('use_road_routing', True),
                osrm_base_url=settings.OSRM_BASE_URL,
            )
        except RoutingSolverError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_422_UNPROCESSABLE_ENTITY)

        points = data['points']
        summary = build_route_summary(result.routes)
        index_map = result.index_map

        def original_node(node_index: int) -> int | None:
            if index_map and 0 <= node_index < len(index_map):
                node_index = index_map[node_index]
            if 0 <= node_index < len(points):
                return node_index
            return None

        response_payload = {
            'problem_type': result.problem_type,
            'routing_engine': result.routing_engine,
            'objective_value': result.objective_value,
            'summary': summary,
            'routes': [
                {
                    'vehicle_id': route.vehicle_id,
                    'distance_meters': route.distance,
                    'duration_minutes': route.duration_minutes,
                    'duration_label': format_duration_minutes(route.duration_minutes),
                    'load': route.load,
                    'node_indices': [
                        resolved
                        for node_index in route.node_indices
                        if (resolved := original_node(node_index)) is not None
                    ],
                    'geometry': route.geometry,
                    'points': [
                        {
                            'index': resolved,
                            'id': points[resolved]['id'],
                            'lat': points[resolved]['lat'],
                            'lng': points[resolved]['lng'],
                            'label': points[resolved].get('label', ''),
                            'type': points[resolved].get('type', 'stop'),
                            'arrival_min': (
                                route.arrival_times[idx][0]
                                if idx < len(route.arrival_times)
                                else None
                            ),
                            'arrival_max': (
                                route.arrival_times[idx][1]
                                if idx < len(route.arrival_times)
                                else None
                            ),
                            'arrival_time': (
                                format_minutes_as_time(route.arrival_times[idx][0])
                                if idx < len(route.arrival_times)
                                else None
                            ),
                        }
                        for idx, node_index in enumerate(route.node_indices)
                        if (resolved := original_node(node_index)) is not None
                    ],
                }
                for route in result.routes
            ],
            'distance_matrix': result.distance_matrix,
            'time_matrix': result.time_matrix,
        }

        history_id = None
        if request.user.is_authenticated:
            entry = save_route_history(request.user, data, response_payload)
            history_id = entry.id

        if history_id is not None:
            response_payload['history_id'] = history_id

        return Response(response_payload)
