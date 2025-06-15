import 'package:data_entry/core/api/decodable.dart';

typedef RootKeyExtractor = List<String> Function(Map<String, dynamic>? data);

///R = Raw type you get from response ( Ex: Using DIO is Response object)
///E = Expected type ( Ex: Common data format you want to get is Map<String,dynamic>
abstract class BaseAPIResponseDataTransformer<R, E, T> {
  RootKeyExtractor rootKeyExtractor;

  E transform(R response, T? genericObject);

  bool isSucceed(R response);

  BaseAPIResponseDataTransformer({required this.rootKeyExtractor});

  dynamic getData(Map<String, dynamic> responseData) {
    dynamic data = responseData;
    for (final key in rootKeyExtractor(responseData)) {
      if (data == null) {
        break;
      }
      data = data[key];
    }
    return data;
  }
}
