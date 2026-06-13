"""Authentification utilisateur et historique des tournées."""

from __future__ import annotations

from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import User
from django.contrib.auth.views import (
    LoginView as DjangoLoginView,
    LogoutView as DjangoLogoutView,
    PasswordResetCompleteView,
    PasswordResetConfirmView,
    PasswordResetDoneView,
    PasswordResetView,
)
from django.urls import reverse_lazy
from django.utils import timezone
from django.views.generic import CreateView
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from routing.forms import LoginForm, SignUpForm
from routing.models import RouteHistory
from routing.throttling import AuthRateThrottle, HistoryRateThrottle


# ---------------------------------------------------------------------------
# Pages HTML (compte)
# ---------------------------------------------------------------------------


class LoginView(DjangoLoginView):
    template_name = 'account/login.html'
    authentication_form = LoginForm
    redirect_authenticated_user = True


class SignUpView(CreateView):
    form_class = SignUpForm
    template_name = 'account/signup.html'
    success_url = reverse_lazy('app')

    def form_valid(self, form):
        response = super().form_valid(form)
        login(self.request, self.object)
        return response


class LogoutView(DjangoLogoutView):
    next_page = reverse_lazy('landing')
    http_method_names = ['get', 'post', 'options']


class AccountPasswordResetView(PasswordResetView):
    template_name = 'account/password_reset_form.html'
    email_template_name = 'account/emails/password_reset_email.txt'
    html_email_template_name = 'account/emails/password_reset_email.html'
    subject_template_name = 'account/emails/password_reset_subject.txt'
    success_url = reverse_lazy('account-password-reset-done')

    def get_form(self, form_class=None):
        form = super().get_form(form_class)
        form.fields['email'].widget.attrs.update({
            'class': 'auth-input',
            'placeholder': 'vous@exemple.fr',
            'autocomplete': 'email',
        })
        return form


class AccountPasswordResetDoneView(PasswordResetDoneView):
    template_name = 'account/password_reset_done.html'


class AccountPasswordResetConfirmView(PasswordResetConfirmView):
    template_name = 'account/password_reset_confirm.html'
    success_url = reverse_lazy('account-password-reset-complete')

    def get_form(self, form_class=None):
        form = super().get_form(form_class)
        for field in form.fields.values():
            field.widget.attrs['class'] = 'auth-input'
            field.widget.attrs.setdefault('autocomplete', 'new-password')
        if 'new_password1' in form.fields:
            form.fields['new_password1'].widget.attrs['placeholder'] = '8 caractères minimum'
            form.fields['new_password2'].widget.attrs['placeholder'] = 'Confirmez le mot de passe'
        return form


class AccountPasswordResetCompleteView(PasswordResetCompleteView):
    template_name = 'account/password_reset_complete.html'


# ---------------------------------------------------------------------------
# API JSON
# ---------------------------------------------------------------------------


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(max_length=128, write_only=True, trim_whitespace=False)


class SignUpSerializer(serializers.Serializer):
    username = serializers.RegexField(
        regex=r'^[\w.@+-]+$',
        max_length=150,
        error_messages={'invalid': 'Nom d\'utilisateur invalide.'},
    )
    email = serializers.EmailField(max_length=254)
    password1 = serializers.CharField(min_length=8, max_length=128, write_only=True)
    password2 = serializers.CharField(min_length=8, max_length=128, write_only=True)

    def validate(self, attrs):
        if attrs['password1'] != attrs['password2']:
            raise serializers.ValidationError({'password2': 'Les mots de passe ne correspondent pas.'})
        if User.objects.filter(username__iexact=attrs['username']).exists():
            raise serializers.ValidationError({'username': 'Ce nom d\'utilisateur est déjà pris.'})
        if User.objects.filter(email__iexact=attrs['email']).exists():
            raise serializers.ValidationError({'email': 'Cette adresse e-mail est déjà utilisée.'})
        return attrs


def user_to_dict(user: User) -> dict:
    return {
        'id': user.id,
        'username': user.username,
        'email': user.email,
    }


class AuthMeView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        if request.user.is_authenticated:
            return Response({'authenticated': True, 'user': user_to_dict(request.user)})
        return Response({'authenticated': False, 'user': None})


class AuthLoginView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [AuthRateThrottle]

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = authenticate(
            request,
            username=serializer.validated_data['username'],
            password=serializer.validated_data['password'],
        )
        if user is None:
            return Response(
                {'detail': 'Identifiants incorrects.'},
                status=status.HTTP_401_UNAUTHORIZED,
            )
        login(request, user)
        return Response({'authenticated': True, 'user': user_to_dict(user)})


class AuthLogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        logout(request)
        return Response({'authenticated': False})


class AuthSignUpView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [AuthRateThrottle]

    def post(self, request):
        serializer = SignUpSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        form = SignUpForm(data={
            'username': data['username'],
            'email': data['email'],
            'password1': data['password1'],
            'password2': data['password2'],
        })
        if not form.is_valid():
            return Response(form.errors, status=status.HTTP_400_BAD_REQUEST)

        user = form.save()
        login(request, user)
        return Response(
            {'authenticated': True, 'user': user_to_dict(user)},
            status=status.HTTP_201_CREATED,
        )


# ---------------------------------------------------------------------------
# Historique
# ---------------------------------------------------------------------------


def history_to_dict(entry: RouteHistory, *, include_payload: bool = False) -> dict:
    payload = {
        'id': entry.id,
        'title': entry.title,
        'problem_type': entry.problem_type,
        'point_count': entry.point_count,
        'summary': entry.summary,
        'created_at': entry.created_at.isoformat(),
    }
    if include_payload:
        payload['config'] = entry.config
        payload['points'] = entry.points
        payload['result'] = entry.result
    return payload


class RouteHistoryListView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [HistoryRateThrottle]

    def get(self, request):
        entries = RouteHistory.objects.filter(user=request.user).order_by('-created_at')[:100]
        return Response({
            'history': [history_to_dict(entry) for entry in entries],
        })


def get_history_entry(request, pk: int) -> RouteHistory:
    return RouteHistory.objects.get(pk=pk, user=request.user)


class RouteHistoryDetailView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [HistoryRateThrottle]

    def get(self, request, pk):
        try:
            entry = get_history_entry(request, pk)
        except RouteHistory.DoesNotExist:
            return Response({'detail': 'Introuvable.'}, status=status.HTTP_404_NOT_FOUND)
        return Response(history_to_dict(entry, include_payload=True))

    def delete(self, request, pk):
        try:
            entry = get_history_entry(request, pk)
        except RouteHistory.DoesNotExist:
            return Response({'detail': 'Introuvable.'}, status=status.HTTP_404_NOT_FOUND)
        entry.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class RouteHistoryRestoreView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [HistoryRateThrottle]

    def post(self, request, pk):
        try:
            entry = get_history_entry(request, pk)
        except RouteHistory.DoesNotExist:
            return Response({'detail': 'Introuvable.'}, status=status.HTTP_404_NOT_FOUND)
        return Response({
            'config': entry.config,
            'points': entry.points,
            'result': entry.result,
        })


def compact_solve_result(payload: dict) -> dict:
    """Retire les matrices volumineuses de l'historique."""
    return {
        key: value
        for key, value in payload.items()
        if key not in ('distance_matrix', 'time_matrix')
    }


def build_config_from_solve_data(data: dict) -> dict:
    return {
        'problem_type': data['problem_type'],
        'num_vehicles': data.get('num_vehicles', 1),
        'enable_capacity': bool(data.get('vehicle_capacities')),
        'vehicle_capacity': (
            data['vehicle_capacities'][0]
            if data.get('vehicle_capacities')
            else 50
        ),
        'enable_time_windows': data.get('use_time_windows', False),
        'use_road_routing': data.get('use_road_routing', True),
        'average_speed_kmh': data.get('average_speed_kmh', 30),
    }


def save_route_history(user, solve_data: dict, response_payload: dict) -> RouteHistory:
    now = timezone.localtime()
    title = now.strftime('Tournée %d/%m/%Y %H:%M')
    return RouteHistory.objects.create(
        user=user,
        title=title,
        problem_type=solve_data['problem_type'],
        config=build_config_from_solve_data(solve_data),
        points=solve_data['points'],
        result=compact_solve_result(response_payload),
        summary=response_payload.get('summary', {}),
        point_count=len(solve_data['points']),
    )
