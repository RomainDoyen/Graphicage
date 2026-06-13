from unittest.mock import patch

from django.test import SimpleTestCase

from routing.services.osrm import durations_to_minutes, fetch_table
from routing.services.solver import RoutingSolverError, solve_routing


class OsrmTests(SimpleTestCase):
    def test_durations_to_minutes(self):
        matrix = [[0, 90], [90, 0]]
        result = durations_to_minutes(matrix)
        self.assertEqual(result[0][1], 2)

    @patch('routing.services.solver.fetch_table')
    @patch('routing.services.solver.fetch_route_details')
    def test_solve_with_osrm_uses_road_matrix(self, mock_route_details, mock_table):
        points = [
            {'id': 0, 'lat': -20.8789, 'lng': 55.4481, 'type': 'depot'},
            {'id': 1, 'lat': -20.8795, 'lng': 55.4490, 'type': 'stop'},
            {'id': 2, 'lat': -20.8800, 'lng': 55.4475, 'type': 'stop'},
        ]
        mock_table.return_value = (
            [[0, 500, 800], [500, 0, 600], [800, 600, 0]],
            [[0, 60, 120], [60, 0, 90], [120, 90, 0]],
        )
        mock_route_details.return_value = (
            [
                [-20.8789, 55.4481],
                [-20.8795, 55.4490],
                [-20.8800, 55.4475],
            ],
            420,
        )

        result = solve_routing(
            points,
            problem_type='tsp',
            use_road_routing=True,
            osrm_base_url='https://router.test',
        )

        self.assertEqual(result.routing_engine, 'osrm')
        mock_table.assert_called_once()
        self.assertTrue(result.routes[0].geometry)
        self.assertEqual(result.routes[0].duration_minutes, 7)

    @patch('routing.services.solver.fetch_table')
    def test_solve_osrm_failure_raises_clear_error(self, mock_table):
        from routing.services.osrm import OsrmError

        mock_table.side_effect = OsrmError('Service indisponible')
        points = [
            {'id': 0, 'lat': -20.8789, 'lng': 55.4481, 'type': 'depot'},
            {'id': 1, 'lat': -20.8795, 'lng': 55.4490, 'type': 'stop'},
        ]
        with self.assertRaises(RoutingSolverError) as ctx:
            solve_routing(
                points,
                use_road_routing=True,
                osrm_base_url='https://router.test',
            )
        self.assertIn('Service indisponible', str(ctx.exception))
