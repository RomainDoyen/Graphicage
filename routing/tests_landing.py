from django.contrib.auth.models import User
from django.test import Client, TestCase
from django.urls import reverse


class LandingAndAppAccessTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.user = User.objects.create_user(username='driver', password='SecurePass123!')

    def test_landing_is_public(self):
        response = self.client.get(reverse('landing'))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'Optimisez vos tournées')

    def test_app_requires_login(self):
        response = self.client.get(reverse('app'))
        self.assertEqual(response.status_code, 302)
        self.assertIn('/compte/connexion/', response.url)

    def test_app_accessible_when_logged_in(self):
        self.client.login(username='driver', password='SecurePass123!')
        response = self.client.get(reverse('app'))
        self.assertEqual(response.status_code, 200)
