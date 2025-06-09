import 'package:flutter/material.dart';
import "supported_locales_enum.dart";

class LocaleService{
  SupportedLocales find(Locale locale) {
  return SupportedLocales.values
      .firstWhere((element) => element.locale == locale);
}
   final String assetLanguage = "assets/translations";

}