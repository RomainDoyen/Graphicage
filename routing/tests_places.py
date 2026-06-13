from unittest.mock import patch

from django.test import SimpleTestCase
from django.urls import reverse
from rest_framework.test import APIClient

from routing.services.places import (
    PlacesError,
    _dedupe_results,
    _in_reunion,
    search_places,
    search_schools,
)


class PlacesHelperTests(SimpleTestCase):
    def test_in_reunion_accepts_saint_denis(self):
        self.assertTrue(_in_reunion(-20.8789, 55.4481))

    def test_in_reunion_rejects_paris(self):
        self.assertFalse(_in_reunion(48.8566, 2.3522))

    def test_dedupe_results_by_coordinates(self):
        items = [
            {'lat': -20.88, 'lng': 55.45, 'label': 'A'},
            {'lat': -20.880001, 'lng': 55.450001, 'label': 'B'},
            {'lat': -20.87, 'lng': 55.44, 'label': 'C'},
        ]
        deduped = _dedupe_results(items, limit=5)
        self.assertEqual(len(deduped), 2)


class PlacesSearchTests(SimpleTestCase):
    @patch('routing.services.places._get_json')
    def test_search_schools_parses_education_api(self, mock_get_json):
        mock_get_json.return_value = {
            'results': [
                {
                    'nom_etablissement': 'École Raymond Mondon',
                    'type_etablissement': 'École',
                    'latitude': -20.8725,
                    'longitude': 55.452,
                    'adresse_1': '71 Rue Alexis de Villeneuve',
                    'nom_commune': 'Saint-Denis',
                    'code_postal': '97400',
                }
            ]
        }
        results = search_schools('mondon', limit=5)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]['type'], 'school')
        self.assertEqual(results[0]['label'], 'École Raymond Mondon')
        self.assertAlmostEqual(results[0]['lat'], -20.8725)

    @patch('routing.services.places.search_poi')
    @patch('routing.services.places.search_addresses')
    @patch('routing.services.places.search_schools')
    def test_search_places_merges_sources_for_all(
        self,
        mock_schools,
        mock_addresses,
        mock_poi,
    ):
        mock_schools.return_value = [
            {'id': '1', 'label': 'École A', 'lat': -20.88, 'lng': 55.45, 'type': 'school'},
        ]
        mock_addresses.return_value = [
            {'id': '2', 'label': 'Rue X', 'lat': -20.87, 'lng': 55.44, 'type': 'pickup'},
        ]
        mock_poi.return_value = [
            {'id': '3', 'label': 'Arrêt Y', 'lat': -20.86, 'lng': 55.43, 'type': 'stop'},
        ]
        results = search_places('test', place_type='all', limit=8)
        self.assertGreaterEqual(len(results), 2)
        mock_schools.assert_called_once()
        mock_addresses.assert_called_once()
        mock_poi.assert_called_once()

    @patch('routing.services.places.search_schools')
    def test_search_places_short_query_returns_empty(self, mock_schools):
        self.assertEqual(search_places('a'), [])
        mock_schools.assert_not_called()


class PlaceSearchApiTests(SimpleTestCase):
    def setUp(self):
        self.client = APIClient()

    def test_api_returns_empty_for_short_query(self):
        response = self.client.get(reverse('place-search'), {'q': 'a'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['results'], [])

    @patch('routing.api_views.search_places')
    def test_api_returns_results(self, mock_search):
        mock_search.return_value = [
            {
                'id': 'school-1',
                'label': 'École Test',
                'subtitle': 'Saint-Denis',
                'type': 'school',
                'lat': -20.88,
                'lng': 55.45,
                'source': 'education',
            }
        ]
        response = self.client.get(
            reverse('place-search'),
            {'q': 'école', 'type': 'school'},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()['results']), 1)

    @patch('routing.api_views.search_places', side_effect=PlacesError('Service down'))
    def test_api_returns_502_on_places_error(self, mock_search):
        response = self.client.get(reverse('place-search'), {'q': 'école', 'type': 'school'})
        self.assertEqual(response.status_code, 502)
