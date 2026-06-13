"""Recherche de lieux — proxy vers APIs publiques (Éducation nationale, Géoplateforme, Photon)."""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

REQUEST_TIMEOUT_SEC = 12

# La Réunion — filtre géographique
REUNION_DEPARTMENT = '974'
REUNION_BBOX = {
    'min_lat': -21.42,
    'max_lat': -20.85,
    'min_lng': 55.20,
    'max_lng': 55.85,
}
REUNION_CENTER = (-20.8789, 55.4481)

EDUCATION_API_URL = (
    'https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/'
    'fr-en-annuaire-education/records'
)
GEOPF_SEARCH_URL = 'https://data.geopf.fr/geocodage/search'
PHOTON_API_URL = 'https://photon.komoot.io/api/'

USER_AGENT = 'GraphicageTER/1.0 (transport scolaire La Réunion)'


class PlacesError(Exception):
    """Erreur lors d'une recherche de lieux externe."""


def _in_reunion(lat: float, lng: float) -> bool:
    bbox = REUNION_BBOX
    return (
        bbox['min_lat'] <= lat <= bbox['max_lat']
        and bbox['min_lng'] <= lng <= bbox['max_lng']
    )


def _escape_odsql(value: str) -> str:
    return value.replace("'", "''").replace('"', '""')


def _get_json(url: str) -> Any:
    request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SEC) as response:
            return json.loads(response.read().decode('utf-8'))
    except urllib.error.URLError as exc:
        raise PlacesError(f'Service de recherche indisponible. ({exc})') from exc
    except json.JSONDecodeError as exc:
        raise PlacesError('Réponse de recherche invalide.') from exc


def _build_subtitle(*parts: str | None) -> str:
    return ', '.join(part.strip() for part in parts if part and str(part).strip())


def _normalize_result(
    *,
    result_id: str,
    label: str,
    subtitle: str,
    lat: float,
    lng: float,
    point_type: str,
    source: str,
) -> dict[str, Any] | None:
    if not label or lat is None or lng is None:
        return None
    try:
        lat_f = float(lat)
        lng_f = float(lng)
    except (TypeError, ValueError):
        return None
    if not _in_reunion(lat_f, lng_f):
        return None
    return {
        'id': result_id,
        'label': label.strip(),
        'subtitle': subtitle.strip(),
        'type': point_type,
        'lat': lat_f,
        'lng': lng_f,
        'source': source,
    }


def search_schools(query: str, limit: int = 8) -> list[dict[str, Any]]:
    """Annuaire Éducation nationale — établissements du 974."""
    escaped = _escape_odsql(query)
    where = (
        f'code_departement="{REUNION_DEPARTMENT}" '
        f'AND search(nom_etablissement, "{escaped}")'
    )
    params = urllib.parse.urlencode(
        {
            'where': where,
            'limit': limit,
            'select': (
                'nom_etablissement,type_etablissement,latitude,longitude,'
                'adresse_1,adresse_2,nom_commune,code_postal'
            ),
        }
    )
    payload = _get_json(f'{EDUCATION_API_URL}?{params}')
    results: list[dict[str, Any]] = []
    for index, record in enumerate(payload.get('results', [])):
        row = record if isinstance(record, dict) else {}
        label = row.get('nom_etablissement') or ''
        type_etab = row.get('type_etablissement') or 'Établissement'
        subtitle = _build_subtitle(
            type_etab,
            row.get('adresse_1'),
            row.get('nom_commune'),
            row.get('code_postal'),
        )
        normalized = _normalize_result(
            result_id=f'school-{index}-{label[:40]}',
            label=label,
            subtitle=subtitle,
            lat=row.get('latitude'),
            lng=row.get('longitude'),
            point_type='school',
            source='education',
        )
        if normalized:
            results.append(normalized)
    return results


def search_addresses(query: str, limit: int = 8, point_type: str = 'pickup') -> list[dict[str, Any]]:
    """Géoplateforme IGN — adresses et lieux (BAN)."""
    lat, lng = REUNION_CENTER
    params = urllib.parse.urlencode(
        {
            'q': query,
            'limit': limit,
            'autocomplete': '1',
            'lat': lat,
            'lon': lng,
        }
    )
    payload = _get_json(f'{GEOPF_SEARCH_URL}?{params}')
    results: list[dict[str, Any]] = []
    for index, feature in enumerate(payload.get('features', [])):
        geometry = feature.get('geometry') or {}
        coords = geometry.get('coordinates') or []
        if len(coords) < 2:
            continue
        lng_val, lat_val = coords[0], coords[1]
        props = feature.get('properties') or {}
        label = props.get('label') or props.get('name') or query
        subtitle = _build_subtitle(
            props.get('city') or props.get('municipality'),
            props.get('postcode'),
        )
        normalized = _normalize_result(
            result_id=f'address-{index}-{label[:40]}',
            label=label,
            subtitle=subtitle,
            lat=lat_val,
            lng=lng_val,
            point_type=point_type,
            source='geoplateforme',
        )
        if normalized:
            results.append(normalized)
    return results


def search_poi(
    query: str,
    limit: int = 8,
    *,
    point_type: str = 'stop',
    osm_tags: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Photon (OSM) — arrêts bus, dépôts et POI."""
    lat, lng = REUNION_CENTER
    params: dict[str, str | int | float] = {
        'q': query,
        'limit': limit,
        'lat': lat,
        'lon': lng,
        'bbox': f'{REUNION_BBOX["min_lng"]},{REUNION_BBOX["min_lat"]},'
        f'{REUNION_BBOX["max_lng"]},{REUNION_BBOX["max_lat"]}',
    }
    query_string = urllib.parse.urlencode(params)
    if osm_tags:
        for tag in osm_tags:
            query_string += '&' + urllib.parse.urlencode({'osm_tag': tag})
    payload = _get_json(f'{PHOTON_API_URL}?{query_string}')
    results: list[dict[str, Any]] = []
    for index, feature in enumerate(payload.get('features', [])):
        geometry = feature.get('geometry') or {}
        coords = geometry.get('coordinates') or []
        if len(coords) < 2:
            continue
        lng_val, lat_val = coords[0], coords[1]
        props = feature.get('properties') or {}
        name = props.get('name') or props.get('street') or query
        subtitle = _build_subtitle(
            props.get('street'),
            props.get('city') or props.get('state'),
            props.get('country'),
        )
        normalized = _normalize_result(
            result_id=f'poi-{index}-{name[:40]}',
            label=name,
            subtitle=subtitle or (props.get('osm_value') or 'OpenStreetMap'),
            lat=lat_val,
            lng=lng_val,
            point_type=point_type,
            source='photon',
        )
        if normalized:
            results.append(normalized)
    return results


def _dedupe_results(results: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    seen: set[tuple[int, int]] = set()
    unique: list[dict[str, Any]] = []
    for item in results:
        key = (round(item['lat'], 5), round(item['lng'], 5))
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
        if len(unique) >= limit:
            break
    return unique


def search_catalog(query: str, place_type: str = 'all', limit: int = 8) -> list[dict[str, Any]]:
    """Lieux enregistrés dans le catalogue Django (admin / Neon)."""
    from routing.models import CatalogPoint

    queryset = CatalogPoint.objects.filter(is_active=True, label__icontains=query)
    if place_type != 'all':
        queryset = queryset.filter(type=place_type)

    results: list[dict[str, Any]] = []
    for point in queryset.order_by('label')[:limit]:
        normalized = _normalize_result(
            result_id=f'catalog-{point.pk}',
            label=point.label,
            subtitle=_build_subtitle(point.address, point.school_label),
            lat=point.lat,
            lng=point.lng,
            point_type=point.type,
            source='catalog',
        )
        if normalized:
            results.append(normalized)
    return results


def search_places(query: str, place_type: str = 'all', limit: int = 8) -> list[dict[str, Any]]:
    """Recherche unifiée selon le type de point demandé."""
    query = query.strip()
    if len(query) < 2:
        return []

    limit = max(1, min(limit, 15))
    place_type = place_type if place_type in {
        'all', 'school', 'pickup', 'delivery', 'depot', 'stop',
    } else 'all'

    results: list[dict[str, Any]] = []

    try:
        catalog_limit = limit if place_type != 'all' else max(2, limit // 3)
        results.extend(search_catalog(query, place_type, catalog_limit))
    except Exception:
        pass

    if place_type in ('all', 'school'):
        per_source = limit if place_type == 'school' else max(3, limit // 2)
        try:
            results.extend(search_schools(query, per_source))
        except PlacesError:
            if place_type == 'school':
                raise

    if place_type in ('all', 'pickup', 'delivery'):
        per_source = limit if place_type in ('pickup', 'delivery') else max(3, limit // 2)
        target = place_type if place_type in ('pickup', 'delivery') else 'pickup'
        try:
            results.extend(search_addresses(query, per_source, point_type=target))
        except PlacesError:
            if place_type in ('pickup', 'delivery'):
                raise

    if place_type in ('all', 'stop', 'depot'):
        per_source = limit if place_type in ('stop', 'depot') else max(2, limit // 3)
        tags = (
            ['amenity:bus_station', 'building:garage', 'landuse:industrial']
            if place_type == 'depot'
            else ['highway:bus_stop', 'public_transport:stop_position']
        )
        target = 'depot' if place_type == 'depot' else 'stop'
        try:
            results.extend(
                search_poi(query, per_source, point_type=target, osm_tags=tags)
            )
        except PlacesError:
            if place_type in ('stop', 'depot'):
                raise

    if not results and place_type == 'all':
        try:
            results.extend(search_poi(query, limit, point_type='stop'))
        except PlacesError:
            pass

    return _dedupe_results(results, limit)
