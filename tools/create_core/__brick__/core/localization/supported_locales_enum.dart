import 'package:flutter/material.dart';

enum SupportedLocales {
  vi("VN"),
  en("US");

  final String countryCode;

  const SupportedLocales(this.countryCode);

  Locale get locale => Locale(name,countryCode);
}
