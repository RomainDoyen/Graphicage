from django import forms
from django.contrib.auth.forms import AuthenticationForm, UserCreationForm
from django.contrib.auth.models import User


class AuthWidgetMixin:
    """Attributs communs pour les champs des formulaires compte."""

    def _style_fields(self):
        for name, field in self.fields.items():
            widget = field.widget
            attrs = widget.attrs
            if 'class' not in attrs:
                attrs['class'] = 'auth-input'
            if isinstance(widget, forms.PasswordInput):
                attrs.setdefault(
                    'autocomplete',
                    'current-password' if name == 'password' else 'new-password',
                )
            elif isinstance(widget, forms.EmailInput):
                attrs.setdefault('autocomplete', 'email')
            elif name == 'username':
                attrs.setdefault('autocomplete', 'username')


class SignUpForm(AuthWidgetMixin, UserCreationForm):
    email = forms.EmailField(
        label='Adresse e-mail',
        required=True,
        widget=forms.EmailInput(attrs={'autocomplete': 'email', 'placeholder': 'vous@exemple.fr'}),
    )

    class Meta:
        model = User
        fields = ('username', 'email', 'password1', 'password2')
        widgets = {
            'username': forms.TextInput(attrs={
                'autocomplete': 'username',
                'placeholder': 'Nom d\'utilisateur',
            }),
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._style_fields()
        self.fields['password1'].widget.attrs['placeholder'] = '8 caractères minimum'
        self.fields['password2'].widget.attrs['placeholder'] = 'Confirmez le mot de passe'


class LoginForm(AuthWidgetMixin, AuthenticationForm):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._style_fields()
        self.fields['username'].widget.attrs['placeholder'] = 'Nom d\'utilisateur'
        self.fields['password'].widget.attrs['placeholder'] = 'Mot de passe'
