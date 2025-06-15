import 'dart:convert';
import 'dart:io';
import 'package:xml/xml.dart' as xml;

const _root = ".";

String flavorCommand = "--flavors=";
String keyStoreCommand = "--genKeyStore=";
String flavorValuesCommand = "--genFlavorValues=";
String dartDefineCommand = "--genDartDefines=";

getValue(String command) => command.split("=").last;

void main(List<String> args) {
  List<String> flavors = [];
  final platforms = ["android", "ios"];
  final modes = ["debug", "release"];
  bool autoGenKeyStore = false;
  bool autoGenDartDefines = false;
  bool autoGenFlavorValues = false;
  Map<String, dynamic> createJson(String flavor, String platform) {
    return {"FLAVOR": flavor};
  }

  for (final e in args) {
    if (e.contains(flavorCommand) && flavors.isEmpty) {
      for (final flavor in e.replaceAll(flavorCommand, "").split(",")) {
        if (flavor.startsWith(RegExp(r"\w"))) {
          flavors.add(flavor);
        }
      }
    }
    if (e.contains(keyStoreCommand) && !autoGenKeyStore) {
      autoGenKeyStore =
          e.replaceAll(keyStoreCommand, "") == "true" ? true : false;
    }
    if (e.contains(flavorValuesCommand) && !autoGenFlavorValues) {
      autoGenFlavorValues = getValue(e) == "true";
    }
    if (e.contains(dartDefineCommand) && !autoGenDartDefines) {
      autoGenDartDefines =
          e.replaceAll(dartDefineCommand, "") == "true" ? true : false;
    }
  }
  print("Flavors $flavors");

  if (autoGenFlavorValues) {
    _genFlavorValues(createJson);
  }

  // if (flavors.isNotEmpty) {
  //   print("Creating config files...");
  //   for (final platform in platforms) {
  //     for (final mode in modes) {
  //       for (final flavor in flavors) {
  //         var builder = xml.XmlBuilder();
  //         String fileName =
  //             "$platform${flavor[0].toUpperCase()}${flavor.substring(1).toLowerCase()}${mode[0].toUpperCase()}${mode.substring(1).toLowerCase()}";
  //         builder.processing('xml', 'version="1.0"');
  //         builder.element(
  //           'component',
  //           attributes: {'name': 'ProjectRunConfigurationManager'},
  //           nest: () {
  //             builder.element(
  //               'configuration',
  //               attributes: {
  //                 'default': 'false',
  //                 'name': fileName,
  //                 'type': 'FlutterRunConfigurationType',
  //                 'factoryName': 'Flutter',
  //               },
  //               nest: () {
  //                 builder.element(
  //                   'option',
  //                   attributes: {
  //                     'name': 'additionalArgs',
  //                     'value':
  //                         '--$mode '
  //                         '--dart-define-from-file=dart_defines/$platform/$flavor.json',
  //                   },
  //                 );
  //                 builder.element(
  //                   'option',
  //                   attributes: {'name': 'filePath', 'value': '\$PROJECT_DIR\$/lib/main.dart'},
  //                 );
  //                 builder.element(
  //                   'option',
  //                   attributes: {'name': 'buildFlavor', 'value': flavor},
  //                 );

  //                 builder.element('method', attributes: {'v': '2'});
  //               },
  //             );
  //           },
  //         );

  //         var xmlDoc = builder.buildDocument();

  //         var filePath = '$_root/.idea/runConfigurations/$fileName.xml';
  //         var xmlFile = File(filePath)..createSync(recursive: true);
  //         xmlFile.writeAsStringSync(xmlDoc.toXmlString(pretty: true));
  //         print("${xmlFile.path} created");
  //       }
  //     }
  //   }
  // }

  if (flavors.isNotEmpty && autoGenDartDefines) {
    print("creating dart defines...");
    for (final platform in platforms) {
      for (final flavor in flavors) {
        var dartDefineFile = File("$_root/dart_defines/$platform/$flavor.json")
          ..createSync(recursive: true);
        dartDefineFile.writeAsStringSync(
          jsonEncode(
            createJson(flavor, platform).map(
              (key, value) =>
                  MapEntry(key.startsWith("_") ? key.substring(1) : key, value),
            ),
          ),
        );
        print("${dartDefineFile.path} created");
      }
    }
    _genFlavorValues(createJson);
  }
  print("autoGenKeyStore $autoGenKeyStore");
  if (flavors.isNotEmpty && autoGenKeyStore) {
    ///create keystore process
    List<String> buildTypes = ["Debug", "Release"];
    String password = 'acc@ss@123';
    print("Creating keystore and key properties...");
    for (final buildType in buildTypes) {
      String path = '$_root/android/key_stores/${buildType.toLowerCase()}';
      Directory directory = Directory(path);
      directory.createSync(recursive: true);
      if (buildType == "Release") {
        for (String flavor in flavors) {
          String aliasName = '$flavor$buildType';
          final file = File(
            "$_root/android/key_properties/${buildType.toLowerCase()}/$flavor.properties",
          )..createSync(recursive: true);
          file.writeAsString('''
keyAlias=$aliasName
keyPassword=$password
storeFile=../../android/key_stores/${buildType.toLowerCase()}/$flavor.jks
storePassword=$password
      ''');
          print("${file.path} created");
          Process.runSync('keytool', [
            '-genkey',
            '-v',
            '-keystore',
            '$path/$flavor.jks',
            '-alias',
            aliasName,
            '-keyalg',
            'RSA',
            '-keysize',
            '2048',
            '-validity',
            '10000',
            '-storetype',
            'jks',
            '-keypass',
            password,
            '-storepass',
            password,
            '-dname',
            'CN=, OU=, O=, L=y, S=, C=HCM',
          ]);
          print("$path/$flavor.jks created");

          if (aliasName.contains('Release')) {
            Process.runSync('keytool', [
              '-importkeystore',
              '-srckeystore',
              '$path/$flavor.jks',
              '-destkeystore',
              '$path/private_key_$flavor.pepk',
              '-deststoretype',
              'pkcs12',
              '-srcstoretype',
              'jks',
              '-srcstorepass',
              password,
              '-deststorepass',
              password,
              '-srcalias',
              aliasName,
              '-srckeypass',
              password,
            ]);
            print("$path/$flavor.pepk created");
          }
        }
      } else if (buildType == "Debug") {
        String flavor="dev";
        String aliasName = '$flavor$buildType';
        final file = File(
          "$_root/android/key_properties/${buildType.toLowerCase()}/debug.properties",
        )..createSync(recursive: true);
        file.writeAsString('''
keyAlias=$aliasName
keyPassword=$password
storeFile=../../android/key_stores/${buildType.toLowerCase()}/$flavor.jks
storePassword=$password
      ''');
        print("${file.path} created");
        Process.runSync('keytool', [
          '-genkey',
          '-v',
          '-keystore',
          '$path/$flavor.jks',
          '-alias',
          aliasName,
          '-keyalg',
          'RSA',
          '-keysize',
          '2048',
          '-validity',
          '10000',
          '-storetype',
          'jks',
          '-keypass',
          password,
          '-storepass',
          password,
          '-dname',
          'CN=, OU=, O=, L=y, S=, C=HCM',
        ]);
        print("$path/$flavor.jks created");

        if (aliasName.contains('Release')) {
          Process.runSync('keytool', [
            '-importkeystore',
            '-srckeystore',
            '$path/$flavor.jks',
            '-destkeystore',
            '$path/private_key_$flavor.pepk',
            '-deststoretype',
            'pkcs12',
            '-srcstoretype',
            'jks',
            '-srcstorepass',
            password,
            '-deststorepass',
            password,
            '-srcalias',
            aliasName,
            '-srckeypass',
            password,
          ]);
          print("$path/$flavor.pepk created");
        }
      }
    }
  }
}

void _genFlavorValues(
  Map<String, dynamic> Function(String flavor, String platform) createJson,
) {
  final flavorValue = File("$_root/lib/configs/flavors_values.g.dart");
  print("creating flavor value.g.dart...");
  flavorValue.createSync(recursive: true);
  print("appending values for flavor_value.g.dart...");
  flavorValue.writeAsStringSync('''
class FlavorValues{
${createJson("_", "").keys.where((element) => !element.startsWith("_")).map((e) => " static String ${e.toLowerCase()}=const String.fromEnvironment('$e');").join("\n")}
}
  ''');
}
