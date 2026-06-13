import json
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse

from routing.api_views import build_route_summary
from routing.models import CatalogPoint, SavedScenario
from routing.services.solver import RouteResult


class BuildRouteSummaryTests(TestCase):
    def test_summary_aggregates_routes(self):
        routes = [
            RouteResult(
                vehicle_id=0,
                node_indices=[0, 1, 2],
                distance=5000,
                duration_minutes=20,
                load=12,
                arrival_times=[],
                geometry=[],
            ),
            RouteResult(
                vehicle_id=1,
                node_indices=[0, 3],
                distance=3000,
                duration_minutes=10,
                load=8,
                arrival_times=[],
                geometry=[],
            ),
        ]
        summary = build_route_summary(routes)
        self.assertEqual(summary['total_distance_meters'], 8000)
        self.assertEqual(summary['total_duration_minutes'], 30)
        self.assertEqual(summary['total_stops'], 5)
        self.assertEqual(summary['vehicle_count'], 2)
        self.assertEqual(summary['max_load'], 12)
        self.assertIn('fuel_liters_estimate', summary)
        self.assertIn('co2_kg_estimate', summary)


class CatalogApiTests(TestCase):
    def setUp(self):
        CatalogPoint.objects.create(
            label='École test',
            type='school',
            lat=-20.88,
            lng=55.45,
        )

    def test_catalog_list_returns_active_points(self):
        response = self.client.get(reverse('catalog-points'))
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data['results']), 1)
        self.assertEqual(data['results'][0]['label'], 'École test')
        self.assertEqual(data['results'][0]['source'], 'catalog')


class ScenarioApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='planner',
            email='planner@example.com',
            password='SecurePass123!',
        )

    def test_create_requires_auth(self):
        payload = {
            'name': 'Tournée du matin',
            'config': {'problem_type': 'pdp'},
            'points': [{'id': 0, 'lat': -20.88, 'lng': 55.45, 'type': 'depot'}],
            'is_public': True,
        }
        response = self.client.post(
            reverse('scenario-list'),
            data=json.dumps(payload),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 401)

    def test_create_and_list_public_scenario(self):
        self.client.login(username='planner', password='SecurePass123!')
        payload = {
            'name': 'Tournée du matin',
            'config': {'problem_type': 'pdp'},
            'points': [{'id': 0, 'lat': -20.88, 'lng': 55.45, 'type': 'depot'}],
            'is_public': True,
        }
        create = self.client.post(
            reverse('scenario-list'),
            data=json.dumps(payload),
            content_type='application/json',
        )
        self.assertEqual(create.status_code, 201)
        created = create.json()
        self.assertEqual(created['name'], 'Tournée du matin')

        listing = self.client.get(reverse('scenario-list'))
        self.assertEqual(listing.status_code, 200)
        slugs = [s['slug'] for s in listing.json()['scenarios']]
        self.assertIn(created['slug'], slugs)

    def test_scenario_detail_get_and_delete(self):
        self.client.login(username='planner', password='SecurePass123!')
        scenario = SavedScenario.objects.create(
            name='Test',
            slug='test-scenario',
            points=[],
            is_public=True,
            user=self.user,
        )
        detail = self.client.get(reverse('scenario-detail', kwargs={'slug': scenario.slug}))
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()['name'], 'Test')

        deleted = self.client.delete(reverse('scenario-detail', kwargs={'slug': scenario.slug}))
        self.assertEqual(deleted.status_code, 204)
        self.assertFalse(SavedScenario.objects.filter(pk=scenario.pk).exists())


class GeocodeApiTests(TestCase):
    @patch('routing.api_views.geocode_address')
    def test_geocode_returns_result(self, mock_geocode):
        mock_geocode.return_value = {
            'lat': -20.88,
            'lng': 55.45,
            'label': 'Saint-Denis',
            'source': 'nominatim',
        }
        response = self.client.post(
            reverse('geocode'),
            data=json.dumps({'address': 'Saint-Denis'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['label'], 'Saint-Denis')


class SolveApiSummaryTests(TestCase):
    def test_solve_includes_summary(self):
        payload = {
            'problem_type': 'tsp',
            'num_vehicles': 1,
            'depot_index': 0,
            'use_time_windows': False,
            'use_road_routing': False,
            'points': [
                {'id': 0, 'lat': -20.8789, 'lng': 55.4481, 'type': 'depot'},
                {'id': 1, 'lat': -20.8795, 'lng': 55.4490, 'type': 'stop'},
                {'id': 2, 'lat': -20.8800, 'lng': 55.4475, 'type': 'stop'},
            ],
        }
        response = self.client.post(
            reverse('solve-route'),
            data=json.dumps(payload),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn('summary', data)
        self.assertGreater(data['summary']['total_distance_meters'], 0)
        self.assertEqual(data['summary']['vehicle_count'], 1)
