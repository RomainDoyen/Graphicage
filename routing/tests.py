from django.test import SimpleTestCase

from routing.services.distance import haversine_meters
from routing.services.solver import RoutingSolverError, solve_routing


class DistanceTests(SimpleTestCase):
    def test_haversine_same_point_is_zero(self):
        self.assertEqual(haversine_meters(-20.88, 55.45, -20.88, 55.45), 0)

    def test_haversine_returns_positive_distance(self):
        distance = haversine_meters(-20.8789, 55.4481, -20.8825, 55.4512)
        self.assertGreater(distance, 0)


class SolverTests(SimpleTestCase):
    def test_tsp_simple_square(self):
        points = [
            {'id': 0, 'lat': -20.8789, 'lng': 55.4481, 'type': 'depot'},
            {'id': 1, 'lat': -20.8795, 'lng': 55.4490, 'type': 'stop'},
            {'id': 2, 'lat': -20.8800, 'lng': 55.4475, 'type': 'stop'},
            {'id': 3, 'lat': -20.8780, 'lng': 55.4470, 'type': 'stop'},
        ]
        result = solve_routing(points, problem_type='tsp', depot_index=0)
        self.assertEqual(len(result.routes), 1)
        self.assertGreater(result.objective_value, 0)
        self.assertEqual(result.routes[0].node_indices[0], 0)

    def test_pdp_requires_pairs(self):
        points = [
            {'id': 0, 'lat': -20.8789, 'lng': 55.4481, 'type': 'depot'},
            {'id': 1, 'lat': -20.8795, 'lng': 55.4490, 'type': 'pickup'},
        ]
        with self.assertRaises(RoutingSolverError):
            solve_routing(points, problem_type='pdp', pickups_deliveries=[])

    def test_pdp_with_pickup_delivery(self):
        points = [
            {'id': 0, 'lat': -20.8789, 'lng': 55.4481, 'type': 'depot'},
            {'id': 1, 'lat': -20.8795, 'lng': 55.4490, 'type': 'pickup', 'demand': 1},
            {'id': 2, 'lat': -20.8800, 'lng': 55.4475, 'type': 'school'},
        ]
        result = solve_routing(
            points,
            problem_type='pdp',
            pickups_deliveries=[[1, 2]],
        )
        self.assertGreater(result.objective_value, 0)
        route = result.routes[0].node_indices
        self.assertLess(route.index(1), route.index(2))

    def test_capacity_rejects_oversized_group(self):
        points = [
            {'id': 0, 'lat': -20.8789, 'lng': 55.4481, 'type': 'depot'},
            {'id': 1, 'lat': -20.8795, 'lng': 55.4490, 'type': 'pickup', 'demand': 5},
            {'id': 2, 'lat': -20.8800, 'lng': 55.4475, 'type': 'school'},
        ]
        with self.assertRaises(RoutingSolverError):
            solve_routing(
                points,
                problem_type='pdp',
                pickups_deliveries=[[1, 2]],
                vehicle_capacities=[4],
            )

    def test_capacity_accepts_within_limit(self):
        points = [
            {'id': 0, 'lat': -20.8789, 'lng': 55.4481, 'type': 'depot'},
            {'id': 1, 'lat': -20.8795, 'lng': 55.4490, 'type': 'pickup', 'demand': 2},
            {'id': 2, 'lat': -20.8800, 'lng': 55.4475, 'type': 'school'},
        ]
        result = solve_routing(
            points,
            problem_type='pdp',
            pickups_deliveries=[[1, 2]],
            vehicle_capacities=[50],
        )
        self.assertLessEqual(result.routes[0].load, 50)

    def test_time_windows_produce_arrival_times(self):
        points = [
            {
                'id': 0,
                'lat': -20.8789,
                'lng': 55.4481,
                'type': 'depot',
                'time_window_start': 360,
                'time_window_end': 420,
            },
            {
                'id': 1,
                'lat': -20.8795,
                'lng': 55.4490,
                'type': 'pickup',
                'demand': 1,
                'time_window_start': 420,
                'time_window_end': 480,
            },
            {
                'id': 2,
                'lat': -20.8800,
                'lng': 55.4475,
                'type': 'school',
                'time_window_start': 450,
                'time_window_end': 510,
            },
        ]
        result = solve_routing(
            points,
            problem_type='pdp',
            pickups_deliveries=[[1, 2]],
            use_time_windows=True,
        )
        self.assertIsNotNone(result.time_matrix)
        self.assertTrue(result.routes[0].arrival_times)
