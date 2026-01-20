import 'auth_token.dart';

class LocalUser {
  AuthToken? authToken;
  String? apiUrl;

  LocalUser({this.apiUrl, this.authToken});

  LocalUser.fromJson(dynamic json) {
    apiUrl = json['apiUrl'];
  }

  LocalUser copyWith({String? apiUrl, AuthToken? authToken}) => LocalUser(
    apiUrl: apiUrl ?? this.apiUrl,
    authToken: authToken ?? this.authToken,
  );

  Map<String, dynamic> toJson() {
    final map = <String, dynamic>{};
    map['apiUrl'] = apiUrl;
    return map;
  }
}
