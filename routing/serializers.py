from rest_framework import serializers


class PointSerializer(serializers.Serializer):
    id = serializers.IntegerField(min_value=0)
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lng = serializers.FloatField(min_value=-180, max_value=180)
    label = serializers.CharField(max_length=200, required=False, allow_blank=True)
    type = serializers.ChoiceField(
        choices=['depot', 'pickup', 'delivery', 'school', 'stop'],
        default='stop',
    )
    demand = serializers.IntegerField(min_value=1, max_value=100, required=False, default=1)
    school_id = serializers.IntegerField(min_value=0, required=False, allow_null=True)
    time_window_start = serializers.IntegerField(min_value=0, max_value=1440, required=False, allow_null=True)
    time_window_end = serializers.IntegerField(min_value=0, max_value=1440, required=False, allow_null=True)

    def validate(self, attrs):
        start = attrs.get('time_window_start')
        end = attrs.get('time_window_end')
        if (start is None) ^ (end is None):
            raise serializers.ValidationError(
                'time_window_start et time_window_end doivent être fournis ensemble.'
            )
        if start is not None and end is not None and start > end:
            raise serializers.ValidationError(
                'time_window_start doit être inférieur ou égal à time_window_end.'
            )
        return attrs


class SolveRequestSerializer(serializers.Serializer):
    problem_type = serializers.ChoiceField(choices=['tsp', 'pdp'], default='tsp')
    points = PointSerializer(many=True)
    num_vehicles = serializers.IntegerField(min_value=1, default=1)
    depot_index = serializers.IntegerField(min_value=0, default=0)
    pickups_deliveries = serializers.ListField(
        child=serializers.ListField(
            child=serializers.IntegerField(min_value=0),
            min_length=2,
            max_length=2,
        ),
        required=False,
        default=list,
    )
    max_distance = serializers.IntegerField(min_value=1000, default=1_000_000, required=False)
    vehicle_capacities = serializers.ListField(
        child=serializers.IntegerField(min_value=1, max_value=200),
        required=False,
        allow_null=True,
    )
    use_time_windows = serializers.BooleanField(default=False, required=False)
    max_route_time = serializers.IntegerField(min_value=30, max_value=1440, default=480, required=False)
    waiting_slack = serializers.IntegerField(min_value=0, max_value=120, default=30, required=False)
    service_time = serializers.IntegerField(min_value=0, max_value=60, default=2, required=False)
    average_speed_kmh = serializers.FloatField(min_value=5, max_value=120, default=30, required=False)
    use_road_routing = serializers.BooleanField(default=True, required=False)

    def validate_points(self, value):
        if len(value) < 2:
            raise serializers.ValidationError('Au moins 2 points sont requis.')
        ids = [point['id'] for point in value]
        if len(ids) != len(set(ids)):
            raise serializers.ValidationError('Les identifiants de points doivent être uniques.')
        return value

    def validate(self, attrs):
        points = attrs['points']
        depot_index = attrs.get('depot_index', 0)
        if depot_index >= len(points):
            raise serializers.ValidationError(
                {'depot_index': 'Index de dépôt hors limites.'}
            )

        capacities = attrs.get('vehicle_capacities')
        num_vehicles = attrs.get('num_vehicles', 1)
        if capacities and len(capacities) != num_vehicles:
            raise serializers.ValidationError(
                {'vehicle_capacities': 'Une capacité par véhicule est requise.'}
            )

        if attrs.get('problem_type') == 'pdp':
            pairs = attrs.get('pickups_deliveries') or []
            if not pairs:
                raise serializers.ValidationError(
                    {'pickups_deliveries': 'Requis pour le mode Pickup & Delivery.'}
                )
            max_index = len(points) - 1
            for pickup, delivery in pairs:
                if pickup > max_index or delivery > max_index:
                    raise serializers.ValidationError(
                        {'pickups_deliveries': 'Index de nœud invalide dans une paire.'}
                    )
                if pickup == delivery:
                    raise serializers.ValidationError(
                        {'pickups_deliveries': 'Ramassage et école doivent être différents.'}
                    )
        return attrs


class GeocodeRequestSerializer(serializers.Serializer):
    address = serializers.CharField(max_length=300)


class SavedScenarioSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=200)
    config = serializers.DictField(required=False, default=dict)
    points = serializers.ListField(required=False, default=list)
    baseline_result = serializers.DictField(required=False, allow_null=True)
    last_result = serializers.DictField(required=False, allow_null=True)
    is_public = serializers.BooleanField(required=False, default=False)


class SavedScenarioUpdateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=200, required=False)
    config = serializers.DictField(required=False)
    points = serializers.ListField(required=False)
    baseline_result = serializers.DictField(required=False, allow_null=True)
    last_result = serializers.DictField(required=False, allow_null=True)
    is_public = serializers.BooleanField(required=False)
