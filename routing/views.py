import json

from django.conf import settings
from django.contrib.auth.decorators import login_required
from django.http import FileResponse, Http404
from django.shortcuts import render
from django.views.decorators.http import require_GET
from pathlib import Path


@require_GET
def landing(request):
    return render(request, 'landing.html')


@login_required
@require_GET
def app(request):
    return render(
        request,
        'routing/index.html',
        {
            'map_center_json': json.dumps(settings.MAP_DEFAULT_CENTER),
            'map_zoom': settings.MAP_DEFAULT_ZOOM,
        },
    )


@require_GET
def documentation(request, path='index.html'):
    doc_root = Path(settings.BASE_DIR) / 'documentation'
    file_path = (doc_root / path).resolve()

    if not str(file_path).startswith(str(doc_root.resolve())):
        raise Http404

    if not file_path.is_file():
        raise Http404

    return FileResponse(file_path.open('rb'))
