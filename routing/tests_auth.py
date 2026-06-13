import json

from django.contrib.auth.models import User
from django.test import Client, TestCase
from django.urls import reverse

from routing.models import RouteHistory
from routing.auth_views import compact_solve_result, save_route_history


class AuthApiTests(TestCase):
    def setUp(self):
        self.client = Client(enforce_csrf_checks=False)
        self.user = User.objects.create_user(
            username='testuser',
            email='test@example.com',
            password='SecurePass123!',
        )

    def test_me_unauthenticated(self):
        response = self.client.get(reverse('auth-me'))
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()['authenticated'])

    def test_login_and_me(self):
        login = self.client.post(
            reverse('auth-login'),
            data=json.dumps({'username': 'testuser', 'password': 'SecurePass123!'}),
            content_type='application/json',
        )
        self.assertEqual(login.status_code, 200)
        self.assertTrue(login.json()['authenticated'])

        me = self.client.get(reverse('auth-me'))
        self.assertTrue(me.json()['authenticated'])
        self.assertEqual(me.json()['user']['username'], 'testuser')

    def test_signup_creates_user(self):
        response = self.client.post(
            reverse('auth-signup'),
            data=json.dumps({
                'username': 'newuser',
                'email': 'new@example.com',
                'password1': 'AnotherPass456!',
                'password2': 'AnotherPass456!',
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 201)
        self.assertTrue(User.objects.filter(username='newuser').exists())

    def test_logout(self):
        self.client.login(username='testuser', password='SecurePass123!')
        response = self.client.post(reverse('auth-logout'))
        self.assertEqual(response.status_code, 200)
        me = self.client.get(reverse('auth-me'))
        self.assertFalse(me.json()['authenticated'])


class HistoryApiTests(TestCase):
    def setUp(self):
        self.client = Client(enforce_csrf_checks=False)
        self.user = User.objects.create_user(
            username='driver',
            email='driver@example.com',
            password='SecurePass123!',
        )
        self.other = User.objects.create_user(
            username='other',
            email='other@example.com',
            password='SecurePass123!',
        )

    def _create_history(self, user=None):
        payload = {
            'problem_type': 'tsp',
            'summary': {'total_distance_label': '1 km'},
            'routes': [],
        }
        return save_route_history(
            user or self.user,
            {
                'problem_type': 'tsp',
                'points': [{'id': 0, 'lat': -20.88, 'lng': 55.45, 'type': 'depot'}],
                'num_vehicles': 1,
            },
            payload,
        )

    def test_history_requires_login(self):
        response = self.client.get(reverse('history-list'))
        self.assertEqual(response.status_code, 403)

    def test_history_list_and_restore(self):
        entry = self._create_history()
        self.client.login(username='driver', password='SecurePass123!')

        listing = self.client.get(reverse('history-list'))
        self.assertEqual(listing.status_code, 200)
        self.assertEqual(len(listing.json()['history']), 1)

        restore = self.client.post(reverse('history-restore', kwargs={'pk': entry.pk}))
        self.assertEqual(restore.status_code, 200)
        self.assertIn('points', restore.json())

    def test_history_isolated_per_user(self):
        entry = self._create_history(user=self.other)
        self.client.login(username='driver', password='SecurePass123!')
        response = self.client.get(reverse('history-detail', kwargs={'pk': entry.pk}))
        self.assertEqual(response.status_code, 404)

    def test_solve_saves_history_when_authenticated(self):
        self.client.login(username='driver', password='SecurePass123!')
        payload = {
            'problem_type': 'tsp',
            'num_vehicles': 1,
            'depot_index': 0,
            'use_time_windows': False,
            'use_road_routing': False,
            'points': [
                {'id': 0, 'lat': -20.8789, 'lng': 55.4481, 'type': 'depot'},
                {'id': 1, 'lat': -20.8795, 'lng': 55.4490, 'type': 'stop'},
            ],
        }
        response = self.client.post(
            reverse('solve-route'),
            data=json.dumps(payload),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn('history_id', response.json())
        self.assertEqual(RouteHistory.objects.filter(user=self.user).count(), 1)


class CompactResultTests(TestCase):
    def test_compact_strips_matrices(self):
        payload = {
            'summary': {},
            'routes': [],
            'distance_matrix': [[0, 1]],
            'time_matrix': [[0, 2]],
        }
        compact = compact_solve_result(payload)
        self.assertNotIn('distance_matrix', compact)
        self.assertNotIn('time_matrix', compact)
