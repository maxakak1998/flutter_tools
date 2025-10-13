import 'dart:convert';

import 'package:{{project_name}}/core/api/api_export.dart';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

class APILogInterceptor extends LogInterceptor {
  APILogInterceptor({this.skipAll = false})
    : super(
        requestBody: true,
        requestHeader: false,
        responseHeader: false,
        responseBody: true,
      );
  final bool skipAll;

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    if (shouldLog(err.requestOptions, skipAll: skipAll)) {
      return super.onError(err, handler);
    } else {
      handler.next(err);
    }
  }

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    if (shouldLog(options, skipAll: skipAll)) {
      if (kDebugMode) {
        print("Curl: ${options.toCurlCmd()}");
      }
      handler.next(options);
    } else {
      handler.next(options);
    }
  }

  @override
  void onResponse(Response response, ResponseInterceptorHandler handler) {
    if (shouldLog(response.requestOptions, skipAll: skipAll)) {
      return super.onResponse(response, handler);
    } else {
      print(
        'Response: "${response.requestOptions.path} ${response.statusCode}',
      );
      handler.next(response);
    }
  }

  bool shouldLog(RequestOptions? options, {bool skipAll = false}) {
    if (skipAll) {
      return false;
    }
    return true;
  }
}

extension Curl on RequestOptions {
  String toCurlCmd({bool showHeader = true}) {
    String cmd = "curl";

    String header =
        showHeader
            ? headers
                .map((key, value) {
                  if (key == "content-type" &&
                      value.toString().contains("multipart/form-data")) {
                    value = "multipart/form-data;";
                  }
                  return MapEntry(key, "-H '$key: $value'");
                })
                .values
                .join(" ")
            : "";
    String url = "$baseUrl$path";
    if (queryParameters.isNotEmpty) {
      String query = queryParameters
          .map((key, value) {
            return MapEntry(key, "$key=$value");
          })
          .values
          .join("&");

      url += (url.contains("?")) ? query : "?$query";
    }
    if (method == "GET") {
      cmd += " $header '$url'";
    } else {
      Map<String, dynamic> files = {};
      String postData = "-d ''";
      if (data != null) {
        if (data is FormData) {
          FormData fdata = data as FormData;
          for (var element in fdata.files) {
            MultipartFile file = element.value;
            files[element.key] = "@${file.filename}";
          }
          for (var element in fdata.fields) {
            files[element.key] = element.value;
          }
          if (files.isNotEmpty) {
            postData = files
                .map((key, value) => MapEntry(key, "-F '$key=$value'"))
                .values
                .join(" ");
          }
        } else if (data is Map<String, dynamic>) {
          files.addAll(data);

          if (files.isNotEmpty) {
            postData = "-d '${json.encode(files).toString()}'";
          }
        } else if (data is List) {
          postData = "-d '${json.encode(data)}'";
        } else {
          postData = "-d '${json.encode(data).toString()}'";
        }
      }

      String method = this.method.toString();
      cmd += " -X $method $postData $header '$url'";
    }

    return cmd;
  }
}
