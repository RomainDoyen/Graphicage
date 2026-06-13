# Generated manually for SavedScenario model

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('routing', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='SavedScenario',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=200, verbose_name='Nom')),
                ('slug', models.SlugField(blank=True, max_length=220, unique=True)),
                ('config', models.JSONField(default=dict, verbose_name='Configuration')),
                ('points', models.JSONField(default=list, verbose_name='Points')),
                ('baseline_result', models.JSONField(blank=True, null=True, verbose_name='Résultat de référence')),
                ('last_result', models.JSONField(blank=True, null=True, verbose_name='Dernier résultat')),
                ('is_public', models.BooleanField(default=False, verbose_name='Partageable')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='scenarios', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'tournée enregistrée',
                'verbose_name_plural': 'tournées enregistrées',
                'ordering': ['-updated_at'],
            },
        ),
    ]
