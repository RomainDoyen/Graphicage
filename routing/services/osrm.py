"""Client OSRM — matrices et géométrie de routes (OpenStreetMap)."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Sequence

DEFAULT_OSRM_URL = 'https://router.project-osrm.org'
REQUEST_TIMEOUT_SEC = 30


class OsrmError(Exception):
    """Erreur lors d'un appel au moteur OSRM."""


def _coords_path(points: Sequence[dict]) -> str:
    """Format OSRM : longitude,latitude séparés par ;"""
    return ';'.join(f"{point['lng']},{point['lat']}" for point in points)


def _get_json(url: str) -> dict:
    request = urllib.request.Request(
        url,
        headers={'User-Agent': 'GraphicageTER/1.0'},
    )
    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SEC) as response:
            payload = json.loads(response.read().decode('utf-8'))
    except urllib.error.URLError as exc:
        raise OsrmError(
            f'Impossible de joindre OSRM. Vérifiez la connexion ou OSRM_BASE_URL. ({exc})'
        ) from exc

    if payload.get('code') != 'Ok':
        message = payload.get('message', 'Réponse OSRM invalide.')
        raise OsrmError(message)
    return payload


def _parse_matrix(values: list[list], size: int, label: str) -> list[list[int]]:
    matrix: list[list[int]] = []
    for i, row in enumerate(values):
        parsed_row: list[int] = []
        for j, cell in enumerate(row):
            if cell is None:
                if i == j:
                    parsed_row.append(0)
                else:
                    raise OsrmError(
                        f'Aucun itinéraire routier entre deux points ({label} indisponible). '
                        'Vérifiez que les points sont accessibles par la route.'
                    )
            else:
                parsed_row.append(int(round(cell)))
        matrix.append(parsed_row)

    if len(matrix) != size:
        raise OsrmError('Matrice OSRM de taille inattendue.')
    return matrix


def fetch_table(
    points: list[dict],
    base_url: str = DEFAULT_OSRM_URL,
    profile: str = 'driving',
) -> tuple[list[list[int]], list[list[int]]]:
    """
    Retourne (distance_matrix en mètres, duration_matrix en secondes).
    """
    if len(points) < 2:
        raise OsrmError('Au moins 2 points sont requis pour OSRM.')

    coords = _coords_path(points)
    url = (
        f"{base_url.rstrip('/')}/table/v1/{profile}/{coords}"
        f"?annotations=distance,duration"
    )
    payload = _get_json(url)
    size = len(points)
    distances = _parse_matrix(payload['distances'], size, 'distance')
    durations = _parse_matrix(payload['durations'], size, 'durée')
    return distances, durations


def durations_to_minutes(duration_matrix: list[list[int]]) -> list[list[int]]:
    """Convertit une matrice de durées OSRM (secondes) en minutes entières."""
    return [
        [0 if i == j else max(1, int(round(seconds / 60))) for j, seconds in enumerate(row)]
        for i, row in enumerate(duration_matrix)
    ]


def fetch_route_details(
    points: list[dict],
    base_url: str = DEFAULT_OSRM_URL,
    profile: str = 'driving',
) -> tuple[list[list[float]], int]:
    """
    Retourne (géométrie [[lat, lng], ...], durée totale en secondes).
    """
    if len(points) < 2:
        if points:
            return [[points[0]['lat'], points[0]['lng']]], 0
        return [], 0

    coords = _coords_path(points)
    url = (
        f"{base_url.rstrip('/')}/route/v1/{profile}/{coords}"
        f"?overview=full&geometries=geojson&steps=false"
    )
    payload = _get_json(url)
    routes = payload.get('routes') or []
    if not routes:
        raise OsrmError('OSRM n\'a retourné aucune géométrie de route.')

    route = routes[0]
    coordinates = route['geometry']['coordinates']
    geometry = [[lat, lng] for lng, lat in coordinates]
    duration_seconds = int(round(route.get('duration', 0)))
    return geometry, duration_seconds


def fetch_route_geometry(
    points: list[dict],
    base_url: str = DEFAULT_OSRM_URL,
    profile: str = 'driving',
) -> list[list[float]]:
    """Retourne une liste de [lat, lng] suivant le réseau routier."""
    geometry, _duration = fetch_route_details(points, base_url=base_url, profile=profile)
    return geometry
