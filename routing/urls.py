from django.urls import path

from routing import api_views, auth_views, views

urlpatterns = [
    path('', views.landing, name='landing'),
    path('app/', views.app, name='app'),
    path('compte/connexion/', auth_views.LoginView.as_view(), name='account-login'),
    path('compte/inscription/', auth_views.SignUpView.as_view(), name='account-signup'),
    path('compte/deconnexion/', auth_views.LogoutView.as_view(), name='account-logout'),
    path(
        'compte/mot-de-passe-oublie/',
        auth_views.AccountPasswordResetView.as_view(),
        name='account-password-reset',
    ),
    path(
        'compte/mot-de-passe-oublie/envoye/',
        auth_views.AccountPasswordResetDoneView.as_view(),
        name='account-password-reset-done',
    ),
    path(
        'compte/reinitialiser/<uidb64>/<token>/',
        auth_views.AccountPasswordResetConfirmView.as_view(),
        name='account-password-reset-confirm',
    ),
    path(
        'compte/reinitialiser/termine/',
        auth_views.AccountPasswordResetCompleteView.as_view(),
        name='account-password-reset-complete',
    ),
    path('api/auth/me/', auth_views.AuthMeView.as_view(), name='auth-me'),
    path('api/auth/login/', auth_views.AuthLoginView.as_view(), name='auth-login'),
    path('api/auth/logout/', auth_views.AuthLogoutView.as_view(), name='auth-logout'),
    path('api/auth/signup/', auth_views.AuthSignUpView.as_view(), name='auth-signup'),
    path('api/history/', auth_views.RouteHistoryListView.as_view(), name='history-list'),
    path('api/history/<int:pk>/', auth_views.RouteHistoryDetailView.as_view(), name='history-detail'),
    path(
        'api/history/<int:pk>/restore/',
        auth_views.RouteHistoryRestoreView.as_view(),
        name='history-restore',
    ),
    path('api/dataset/sample/', api_views.SampleDatasetView.as_view(), name='sample-dataset'),
    path('api/dataset/template/', api_views.ImportTemplateView.as_view(), name='import-template'),
    path('api/places/search/', api_views.PlaceSearchView.as_view(), name='place-search'),
    path('api/catalog/points/', api_views.CatalogPointListView.as_view(), name='catalog-points'),
    path('api/geocode/', api_views.GeocodeView.as_view(), name='geocode'),
    path('api/scenarios/', api_views.ScenarioListCreateView.as_view(), name='scenario-list'),
    path('api/scenarios/<slug:slug>/', api_views.ScenarioDetailView.as_view(), name='scenario-detail'),
    path('api/route/solve/', api_views.SolveRouteView.as_view(), name='solve-route'),
    path('documentation/', views.documentation, name='documentation'),
    path('documentation/<path:path>', views.documentation, name='documentation-file'),
]
