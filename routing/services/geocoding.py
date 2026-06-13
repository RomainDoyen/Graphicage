import json
import urllib.error
import urllib.parse
import urllib.request

from django.conf import settings


class GeocodingError(Exception):
    pass


def geocode_address(address: str) -> dict:
    address = address.strip()
    if not address:
        raise GeocodingError('Adresse vide.')

    if settings.GOOGLE_API_KEY:
        return _geocode_google(address)
    return _geocode_nominatim(address)


def _geocode_google(address: str) -> dict:
    params = urllib.parse.urlencode({
        'address': address,
        'key': settings.GOOGLE_API_KEY,
        'region': 're',
    })
    url = f'https://maps.googleapis.com/maps/api/geocode/json?{params}'
    try:
        with urllib.request.urlopen(url, timeout=10) as response:
            payload = json.loads(response.read().decode())
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise GeocodingError('Service de géocodage Google indisponible.') from exc

    if payload.get('status') != 'OK' or not payload.get('results'):
        raise GeocodingError('Adresse introuvable.')

    result = payload['results'][0]
    location = result['geometry']['location']
    return {
        'label': result.get('formatted_address', address),
        'lat': location['lat'],
        'lng': location['lng'],
        'source': 'google',
    }


def _geocode_nominatim(address: str) -> dict:
    params = urllib.parse.urlencode({
        'q': f'{address}, La Réunion',
        'format': 'json',
        'limit': 1,
    })
    url = f'https://nominatim.openstreetmap.org/search?{params}'
    request = urllib.request.Request(
        url,
        headers={'User-Agent': 'GraphicageTER/1.0 (transport scolaire)'},
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            results = json.loads(response.read().decode())
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise GeocodingError('Service de géocodage Nominatim indisponible.') from exc

    if not results:
        raise GeocodingError('Adresse introuvable.')

    hit = results[0]
    return {
        'label': hit.get('display_name', address),
        'lat': float(hit['lat']),
        'lng': float(hit['lon']),
        'source': 'nominatim',
    }
