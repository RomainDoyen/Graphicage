from django.contrib import admin

from routing.models import CatalogPoint, RouteHistory, SavedScenario


@admin.register(CatalogPoint)
class CatalogPointAdmin(admin.ModelAdmin):
    list_display = ('label', 'type', 'lat', 'lng', 'is_active', 'updated_at')
    list_filter = ('type', 'is_active')
    search_fields = ('label', 'address', 'school_label')
    ordering = ('type', 'label')


@admin.register(SavedScenario)
class SavedScenarioAdmin(admin.ModelAdmin):
    list_display = ('name', 'slug', 'user', 'is_public', 'updated_at')
    list_filter = ('is_public',)
    search_fields = ('name', 'slug')
    readonly_fields = ('created_at', 'updated_at')
    prepopulated_fields = {'slug': ('name',)}


@admin.register(RouteHistory)
class RouteHistoryAdmin(admin.ModelAdmin):
    list_display = ('title', 'user', 'problem_type', 'point_count', 'created_at')
    list_filter = ('problem_type', 'created_at')
    search_fields = ('title', 'user__username')
    readonly_fields = ('created_at',)
    ordering = ('-created_at',)
