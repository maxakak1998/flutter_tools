class LocalUser {
  LocalUser({this.apiUrl});

  LocalUser.fromJson(dynamic json) {
    apiUrl = json['apiUrl'];
  }

  String? apiUrl;

  LocalUser copyWith({String? apiUrl}) =>
      LocalUser(apiUrl: apiUrl ?? this.apiUrl);

  Map<String, dynamic> toJson() {
    final map = <String, dynamic>{};
    map['apiUrl'] = apiUrl;
    return map;
  }
}
