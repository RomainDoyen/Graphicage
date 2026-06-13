from django.conf import settings
from django.db import models


class CatalogPoint(models.Model):
    class PointType(models.TextChoices):
        DEPOT = 'depot', 'Dépôt'
        PICKUP = 'pickup', 'Ramassage'
        DELIVERY = 'delivery', 'Livraison'
        SCHOOL = 'school', 'École'
        STOP = 'stop', 'Arrêt'

    label = models.CharField('Nom', max_length=200)
    type = models.CharField(
        'Type',
        max_length=20,
        choices=PointType.choices,
        default=PointType.STOP,
    )
    lat = models.FloatField('Latitude')
    lng = models.FloatField('Longitude')
    address = models.CharField('Adresse', max_length=300, blank=True)
    school_label = models.CharField(
        'École associée (ramassage)',
        max_length=200,
        blank=True,
        help_text="Pour les points de ramassage : nom de l'école de destination.",
    )
    is_active = models.BooleanField('Actif', default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'lieu de référence'
        verbose_name_plural = 'lieux de référence'
        ordering = ['type', 'label']

    def __str__(self):
        return self.label


class SavedScenario(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='scenarios',
    )
    name = models.CharField('Nom', max_length=200)
    slug = models.SlugField(max_length=220, unique=True, blank=True)
    config = models.JSONField('Configuration', default=dict)
    points = models.JSONField('Points', default=list)
    baseline_result = models.JSONField('Résultat de référence', null=True, blank=True)
    last_result = models.JSONField('Dernier résultat', null=True, blank=True)
    is_public = models.BooleanField('Partageable', default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'tournée enregistrée'
        verbose_name_plural = 'tournées enregistrées'
        ordering = ['-updated_at']

    def __str__(self):
        return self.name


class RouteHistory(models.Model):
    """Historique des itinéraires calculés par un utilisateur connecté."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='route_history',
    )
    title = models.CharField('Titre', max_length=200)
    problem_type = models.CharField('Type de problème', max_length=10)
    config = models.JSONField('Configuration', default=dict)
    points = models.JSONField('Points', default=list)
    result = models.JSONField('Résultat')
    summary = models.JSONField('Résumé', default=dict)
    point_count = models.PositiveSmallIntegerField('Nombre de points', default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'historique de tournée'
        verbose_name_plural = 'historiques de tournées'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', '-created_at']),
        ]

    def __str__(self):
        return self.title
