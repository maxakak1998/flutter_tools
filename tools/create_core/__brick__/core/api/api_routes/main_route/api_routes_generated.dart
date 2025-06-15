// GENERATED CODE - DO NOT MODIFY BY HAND

import 'package:dio/dio.dart';
import 'package:{{project_name}}/core/api/decodable.dart';

// === RequestOptions Generator ===
class MainRouteApiRoutesGenerated {
  static RequestOptions login({BaseOptions? baseOption, required String username, required String password, String? apiurl}) {
    baseOption??= BaseOptions();
    final options = Options(
      method: 'POST',
      headers: {"Content-Type":"application/json"},
      extra: {
        "auth": false,
      },
    ).compose(baseOption, '/member/mobileApplicationLogin', data: {"username": username, "password": password, "apiurl": apiurl});
    return options;
  }

  static RequestOptions getMeter({BaseOptions? baseOption, required num page, required num limit, String? keyword, String? meterTypeId, String? serviceTypeId, String? mainOrSub}) {
    baseOption??= BaseOptions();
    final options = Options(
      method: 'POST',
      headers: {"Content-Type":"application/json"},
      extra: {
      },
    ).compose(baseOption, '/member/getMeter', data: {"page": page, "limit": limit, "keyword": keyword, "meterTypeId": meterTypeId, "serviceTypeId": serviceTypeId, "mainOrSub": mainOrSub});
    return options;
  }

  static RequestOptions metaData({BaseOptions? baseOption}) {
    baseOption??= BaseOptions();
    final options = Options(
      method: 'GET',
      headers: {"Content-Type":"application/json"},
      extra: {
      },
    ).compose(baseOption, '/member/getMetaData');
    return options;
  }

  static RequestOptions meterReading({BaseOptions? baseOption, required List<MeterReadingParam> data}) {
    baseOption??= BaseOptions();
    final options = Options(
      method: 'POST',
      headers: {"Content-Type":"application/json"},
      extra: {
      },
    ).compose(baseOption, '/member/reading', data: data.map((e) => e.toJson()).toList());
    return options;
  }

  static RequestOptions lastMeterReading({BaseOptions? baseOption, required num MeterID}) {
    baseOption??= BaseOptions();
    final options = Options(
      method: 'POST',
      headers: {"Content-Type":"application/json"},
      extra: {
      },
    ).compose(baseOption, '/member/getLastReading', data: {"Meter_ID": MeterID});
    return options;
  }

  static RequestOptions uploads({BaseOptions? baseOption}) {
    baseOption??= BaseOptions();
    final options = Options(
      method: 'POST',
      headers: {"Content-Type":"multipart/form-data"},
      extra: {
      },
    ).compose(baseOption, '/member/uploads');
    return options;
  }

  static RequestOptions upload({BaseOptions? baseOption}) {
    baseOption??= BaseOptions();
    final options = Options(
      method: 'POST',
      headers: {"Content-Type":"multipart/form-data"},
      extra: {
      },
    ).compose(baseOption, '/member/upload');
    return options;
  }

  static RequestOptions uploadImages({BaseOptions? baseOption, required String ID, required List<String> ImageURL}) {
    baseOption??= BaseOptions();
    final options = Options(
      method: 'POST',
      headers: {"Content-Type":"application/json"},
      extra: {
      },
    ).compose(baseOption, '/member/uploadImages', data: {"ID": ID, "ImageURL": ImageURL});
    return options;
  }

  static RequestOptions scanQRCode({BaseOptions? baseOption, required String QRCode}) {
    baseOption??= BaseOptions();
    final options = Options(
      method: 'POST',
      headers: {"Content-Type":"application/json"},
      extra: {
      },
    ).compose(baseOption, '/member/scanQRCode', data: {"QRCode": QRCode});
    return options;
  }

  static RequestOptions addQRCode({BaseOptions? baseOption, required String ID, required String QRCode}) {
    baseOption??= BaseOptions();
    final options = Options(
      method: 'POST',
      headers: {"Content-Type":"application/json"},
      extra: {
      },
    ).compose(baseOption, '/member/addQRCode', data: {"ID": ID, "QRCode": QRCode});
    return options;
  }

  static RequestOptions updateMeter({BaseOptions? baseOption, required String ID, String? NotePad, String? LocationNote, String? SerialNo, String? MeterCapacity, String? IndiaBPNumber, String? IndiaMeterAddress, String? IndiaMeterManufacture, String? IndiaMeterModel, String? IndiaServiceType, String? IndiaMeasureUnit, String? IndiaDataCollectionFrequency, String? DevEUI, String? AMRSerialNo, String? AutoImportCode, String? DataCollectionFrequencyPeriod, String? DataCollectionFrequencyQty, String? Description}) {
    baseOption??= BaseOptions();
    final options = Options(
      method: 'POST',
      headers: {"Content-Type":"application/json"},
      extra: {
      },
    ).compose(baseOption, '/member/updateMeter', data: {"ID": ID, "NotePad": NotePad, "LocationNote": LocationNote, "Serial_No": SerialNo, "Meter_Capacity": MeterCapacity, "India_BP_Number": IndiaBPNumber, "India_Meter_Address": IndiaMeterAddress, "India_Meter_Manufacture": IndiaMeterManufacture, "India_Meter_Model": IndiaMeterModel, "India_Service_Type": IndiaServiceType, "India_Measure_Unit": IndiaMeasureUnit, "India_Data_Collection_Frequency": IndiaDataCollectionFrequency, "DevEUI": DevEUI, "AMR_Serial_No": AMRSerialNo, "Auto_Import_Code": AutoImportCode, "Data_Collection_Frequency_Period": DataCollectionFrequencyPeriod, "Data_Collection_Frequency_Qty": DataCollectionFrequencyQty, "Description": Description});
    return options;
  }

  static RequestOptions getCustomer({BaseOptions? baseOption, required num page, required num limit, String? keyword, String? meterTypeId, String? serviceTypeId, String? mainOrSub}) {
    baseOption??= BaseOptions();
    final options = Options(
      method: 'POST',
      headers: {"Content-Type":"application/json"},
      extra: {
      },
    ).compose(baseOption, '/member/getCustomer', data: {"page": page, "limit": limit, "keyword": keyword, "meterTypeId": meterTypeId, "serviceTypeId": serviceTypeId, "mainOrSub": mainOrSub});
    return options;
  }

  static RequestOptions addCustomer({BaseOptions? baseOption, required num MeterID, required String FirstName, required String LastName, required String Address, required String SignatureImage}) {
    baseOption??= BaseOptions();
    final options = Options(
      method: 'POST',
      headers: {"Content-Type":"application/json"},
      extra: {
      },
    ).compose(baseOption, '/member/addCustomer', data: {"MeterID": MeterID, "FirstName": FirstName, "LastName": LastName, "Address": Address, "SignatureImage": SignatureImage});
    return options;
  }

  static RequestOptions updateCustomer({BaseOptions? baseOption, required String ID, String? FirstName, String? LastName, String? Address}) {
    baseOption??= BaseOptions();
    final options = Options(
      method: 'POST',
      headers: {"Content-Type":"application/json"},
      extra: {
      },
    ).compose(baseOption, '/member/updateCustomer', data: {"ID": ID, "FirstName": FirstName, "LastName": LastName, "Address": Address});
    return options;
  }

  static RequestOptions addSignature({BaseOptions? baseOption, required String ID, required String SignatureImage}) {
    baseOption??= BaseOptions();
    final options = Options(
      method: 'POST',
      headers: {"Content-Type":"application/json"},
      extra: {
      },
    ).compose(baseOption, '/member/addSignature', data: {"ID": ID, "SignatureImage": SignatureImage});
    return options;
  }

  static RequestOptions updateAMR({BaseOptions? baseOption, required String ID, required String IndiaLinkAMR}) {
    baseOption??= BaseOptions();
    final options = Options(
      method: 'POST',
      headers: {"Content-Type":"application/json"},
      extra: {
      },
    ).compose(baseOption, '/member/updateAMR', data: {"ID": ID, "India_Link_AMR": IndiaLinkAMR});
    return options;
  }

  static RequestOptions searchDevEUI({BaseOptions? baseOption, required String keyword}) {
    baseOption??= BaseOptions();
    final options = Options(
      method: 'POST',
      headers: {"Content-Type":"application/json"},
      extra: {
      },
    ).compose(baseOption, '/member/searchDevui', data: {"keyword": keyword});
    return options;
  }

  static RequestOptions getAddressDetail({BaseOptions? baseOption, required String MeterID}) {
    baseOption??= BaseOptions();
    final options = Options(
      method: 'POST',
      headers: {"Content-Type":"application/json"},
      extra: {
      },
    ).compose(baseOption, '/member/getAddressDetail', data: {"Meter_ID": MeterID});
    return options;
  }

  static RequestOptions updateAddress({BaseOptions? baseOption, required String MeterID, String? Name, String? Address, String? Address1, String? Address2, String? Postcode, String? Country, String? ContactNumber, String? FromDate, String? ToDate, String? CreatedOn, bool? IsUnoccupied, String? BuildingName, String? SocietyName, String? FlatNo, String? FloorNo, String? WingName, String? PlotNo, String? RoadName, String? Landmark, String? Colony, String? Location, String? City, String? District}) {
    baseOption??= BaseOptions();
    final options = Options(
      method: 'POST',
      headers: {"Content-Type":"application/json"},
      extra: {
      },
    ).compose(baseOption, '/member/updateAddress', data: {"Meter_ID": MeterID, "Name": Name, "Address": Address, "Address1": Address1, "Address2": Address2, "Postcode": Postcode, "Country": Country, "Contact_Number": ContactNumber, "FromDate": FromDate, "ToDate": ToDate, "Created_On": CreatedOn, "IsUnoccupied": IsUnoccupied, "Building_Name": BuildingName, "Society_Name": SocietyName, "Flat_No": FlatNo, "Floor_No": FloorNo, "Wing_Name": WingName, "Plot_No": PlotNo, "Road_Name": RoadName, "Landmark": Landmark, "Colony": Colony, "Location": Location, "City": City, "District": District});
    return options;
  }

  static RequestOptions regularLogin({BaseOptions? baseOption, required String username, required String password, String? apiurl}) {
    baseOption??= BaseOptions();
    final options = Options(
      method: 'POST',
      headers: {"Content-Type":"application/json"},
      extra: {
        "auth": false,
      },
    ).compose(baseOption, '/member/login', data: {"username": username, "password": password, "apiurl": apiurl});
    return options;
  }

  static RequestOptions getReadingType({BaseOptions? baseOption}) {
    baseOption??= BaseOptions();
    final options = Options(
      method: 'GET',
      headers: {"Content-Type":"application/json"},
      extra: {
      },
    ).compose(baseOption, '/member/getReadingType');
    return options;
  }

}


// === Models ===
class Login extends Decoder<Login> {
   String? username;
   String? password;
   String? apiurl;

  Login({
     this.username,
     this.password,
     this.apiurl,
  });

  factory Login.fromJson(Map<String, dynamic> json) => Login(
    username: (json['username'] as String?)?.trim(),
    password: (json['password'] as String?)?.trim(),
    apiurl: (json['apiurl'] as String?)?.trim(),
  );

  @override
  Login decode(Map<String, dynamic> json) => Login.fromJson(json);

  Login copyWith({
    String? username,
    String? password,
    String? apiurl,
  }) {
    return Login(
      username: username ?? this.username,
      password: password ?? this.password,
      apiurl: apiurl ?? this.apiurl,
    );
  }

  Map<String, dynamic> toJson() => {
        'username': username,
        'password': password,
        'apiurl': apiurl,
      };

}


class GetMeter extends Decoder<GetMeter> {
   String? ID;
   String? Description;
   String? MeterTypeID;
   String? ServiceTypeID;
   String? ReadingsOrDeliveries;
   String? ImageUrl;
   String? Utility;
   String? ObjectSubtype;
   String? NotePad;
   String? LocationNote;
   String? MPNo;
   String? ImageUpload;
   List<String>? Images;
   String? QRCode;
   String? MainOrSub;
   String? DevEUI;
   String? IndiaBPNumber;
   String? SerialNo;
   String? IndiaMeterAddress;
   String? IndiaMeterManufacture;
   String? IndiaMeterModel;
   String? IndiaServiceType;
   String? IndiaMeasureUnit;
   String? MeterCapacity;
   String? IndiaDataCollectionFrequency;
   String? DataCollectionFrequencyPeriod;
   String? DataCollectionFrequencyQty;
   String? IndiaLinkAMR;
   String? AMRSerialNo;
   String? CustomerFirstName;
   String? CustomerLastName;
   String? CustomerAddress;
   String? CustomerSignatureImage;
   String? CustomerSignatureDate;
   String? ModelType;
   String? AutoImportCode;
   String? ManualMeterID;

  GetMeter({
     this.ID,
     this.Description,
     this.MeterTypeID,
     this.ServiceTypeID,
     this.ReadingsOrDeliveries,
     this.ImageUrl,
     this.Utility,
     this.ObjectSubtype,
     this.NotePad,
     this.LocationNote,
     this.MPNo,
     this.ImageUpload,
     this.Images,
     this.QRCode,
     this.MainOrSub,
     this.DevEUI,
     this.IndiaBPNumber,
     this.SerialNo,
     this.IndiaMeterAddress,
     this.IndiaMeterManufacture,
     this.IndiaMeterModel,
     this.IndiaServiceType,
     this.IndiaMeasureUnit,
     this.MeterCapacity,
     this.IndiaDataCollectionFrequency,
     this.DataCollectionFrequencyPeriod,
     this.DataCollectionFrequencyQty,
     this.IndiaLinkAMR,
     this.AMRSerialNo,
     this.CustomerFirstName,
     this.CustomerLastName,
     this.CustomerAddress,
     this.CustomerSignatureImage,
     this.CustomerSignatureDate,
     this.ModelType,
     this.AutoImportCode,
     this.ManualMeterID,
  });

  factory GetMeter.fromJson(Map<String, dynamic> json) => GetMeter(
    ID: (json['ID'] as String?)?.trim(),
    Description: (json['Description'] as String?)?.trim(),
    MeterTypeID: (json['MeterTypeID'] as String?)?.trim(),
    ServiceTypeID: (json['ServiceTypeID'] as String?)?.trim(),
    ReadingsOrDeliveries: (json['Readings_Or_Deliveries'] as String?)?.trim(),
    ImageUrl: (json['ImageUrl'] as String?)?.trim(),
    Utility: (json['Utility'] as String?)?.trim(),
    ObjectSubtype: (json['Object_Subtype'] as String?)?.trim(),
    NotePad: (json['NotePad'] as String?)?.trim(),
    LocationNote: (json['LocationNote'] as String?)?.trim(),
    MPNo: (json['MP_No'] as String?)?.trim(),
    ImageUpload: (json['ImageUpload'] as String?)?.trim(),
    Images: (json['Images'] as List?)?.map((e) => (e as String).trim()).toList(),
    QRCode: (json['QRCode'] as String?)?.trim(),
    MainOrSub: (json['MainOrSub'] as String?)?.trim(),
    DevEUI: (json['DevEUI'] as String?)?.trim(),
    IndiaBPNumber: (json['India_BP_Number'] as String?)?.trim(),
    SerialNo: (json['Serial_No'] as String?)?.trim(),
    IndiaMeterAddress: (json['India_Meter_Address'] as String?)?.trim(),
    IndiaMeterManufacture: (json['India_Meter_Manufacture'] as String?)?.trim(),
    IndiaMeterModel: (json['India_Meter_Model'] as String?)?.trim(),
    IndiaServiceType: (json['India_Service_Type'] as String?)?.trim(),
    IndiaMeasureUnit: (json['India_Measure_Unit'] as String?)?.trim(),
    MeterCapacity: (json['Meter_Capacity'] as String?)?.trim(),
    IndiaDataCollectionFrequency: (json['India_Data_Collection_Frequency'] as String?)?.trim(),
    DataCollectionFrequencyPeriod: (json['Data_Collection_Frequency_Period'] as String?)?.trim(),
    DataCollectionFrequencyQty: (json['Data_Collection_Frequency_Qty'] as String?)?.trim(),
    IndiaLinkAMR: (json['India_Link_AMR'] as String?)?.trim(),
    AMRSerialNo: (json['AMR_Serial_No'] as String?)?.trim(),
    CustomerFirstName: (json['Customer_First_Name'] as String?)?.trim(),
    CustomerLastName: (json['Customer_Last_Name'] as String?)?.trim(),
    CustomerAddress: (json['Customer_Address'] as String?)?.trim(),
    CustomerSignatureImage: (json['Customer_Signature_Image'] as String?)?.trim(),
    CustomerSignatureDate: (json['Customer_Signature_Date'] as String?)?.trim(),
    ModelType: (json['Model_Type'] as String?)?.trim(),
    AutoImportCode: (json['Auto_Import_Code'] as String?)?.trim(),
    ManualMeterID: (json['Manual_Meter_ID'] as String?)?.trim(),
  );

  @override
  GetMeter decode(Map<String, dynamic> json) => GetMeter.fromJson(json);

  GetMeter copyWith({
    String? ID,
    String? Description,
    String? MeterTypeID,
    String? ServiceTypeID,
    String? ReadingsOrDeliveries,
    String? ImageUrl,
    String? Utility,
    String? ObjectSubtype,
    String? NotePad,
    String? LocationNote,
    String? MPNo,
    String? ImageUpload,
    List<String>? Images,
    String? QRCode,
    String? MainOrSub,
    String? DevEUI,
    String? IndiaBPNumber,
    String? SerialNo,
    String? IndiaMeterAddress,
    String? IndiaMeterManufacture,
    String? IndiaMeterModel,
    String? IndiaServiceType,
    String? IndiaMeasureUnit,
    String? MeterCapacity,
    String? IndiaDataCollectionFrequency,
    String? DataCollectionFrequencyPeriod,
    String? DataCollectionFrequencyQty,
    String? IndiaLinkAMR,
    String? AMRSerialNo,
    String? CustomerFirstName,
    String? CustomerLastName,
    String? CustomerAddress,
    String? CustomerSignatureImage,
    String? CustomerSignatureDate,
    String? ModelType,
    String? AutoImportCode,
    String? ManualMeterID,
  }) {
    return GetMeter(
      ID: ID ?? this.ID,
      Description: Description ?? this.Description,
      MeterTypeID: MeterTypeID ?? this.MeterTypeID,
      ServiceTypeID: ServiceTypeID ?? this.ServiceTypeID,
      ReadingsOrDeliveries: ReadingsOrDeliveries ?? this.ReadingsOrDeliveries,
      ImageUrl: ImageUrl ?? this.ImageUrl,
      Utility: Utility ?? this.Utility,
      ObjectSubtype: ObjectSubtype ?? this.ObjectSubtype,
      NotePad: NotePad ?? this.NotePad,
      LocationNote: LocationNote ?? this.LocationNote,
      MPNo: MPNo ?? this.MPNo,
      ImageUpload: ImageUpload ?? this.ImageUpload,
      Images: Images ?? this.Images,
      QRCode: QRCode ?? this.QRCode,
      MainOrSub: MainOrSub ?? this.MainOrSub,
      DevEUI: DevEUI ?? this.DevEUI,
      IndiaBPNumber: IndiaBPNumber ?? this.IndiaBPNumber,
      SerialNo: SerialNo ?? this.SerialNo,
      IndiaMeterAddress: IndiaMeterAddress ?? this.IndiaMeterAddress,
      IndiaMeterManufacture: IndiaMeterManufacture ?? this.IndiaMeterManufacture,
      IndiaMeterModel: IndiaMeterModel ?? this.IndiaMeterModel,
      IndiaServiceType: IndiaServiceType ?? this.IndiaServiceType,
      IndiaMeasureUnit: IndiaMeasureUnit ?? this.IndiaMeasureUnit,
      MeterCapacity: MeterCapacity ?? this.MeterCapacity,
      IndiaDataCollectionFrequency: IndiaDataCollectionFrequency ?? this.IndiaDataCollectionFrequency,
      DataCollectionFrequencyPeriod: DataCollectionFrequencyPeriod ?? this.DataCollectionFrequencyPeriod,
      DataCollectionFrequencyQty: DataCollectionFrequencyQty ?? this.DataCollectionFrequencyQty,
      IndiaLinkAMR: IndiaLinkAMR ?? this.IndiaLinkAMR,
      AMRSerialNo: AMRSerialNo ?? this.AMRSerialNo,
      CustomerFirstName: CustomerFirstName ?? this.CustomerFirstName,
      CustomerLastName: CustomerLastName ?? this.CustomerLastName,
      CustomerAddress: CustomerAddress ?? this.CustomerAddress,
      CustomerSignatureImage: CustomerSignatureImage ?? this.CustomerSignatureImage,
      CustomerSignatureDate: CustomerSignatureDate ?? this.CustomerSignatureDate,
      ModelType: ModelType ?? this.ModelType,
      AutoImportCode: AutoImportCode ?? this.AutoImportCode,
      ManualMeterID: ManualMeterID ?? this.ManualMeterID,
    );
  }

  Map<String, dynamic> toJson() => {
        'ID': ID,
        'Description': Description,
        'MeterTypeID': MeterTypeID,
        'ServiceTypeID': ServiceTypeID,
        'Readings_Or_Deliveries': ReadingsOrDeliveries,
        'ImageUrl': ImageUrl,
        'Utility': Utility,
        'Object_Subtype': ObjectSubtype,
        'NotePad': NotePad,
        'LocationNote': LocationNote,
        'MP_No': MPNo,
        'ImageUpload': ImageUpload,
        'Images': Images,
        'QRCode': QRCode,
        'MainOrSub': MainOrSub,
        'DevEUI': DevEUI,
        'India_BP_Number': IndiaBPNumber,
        'Serial_No': SerialNo,
        'India_Meter_Address': IndiaMeterAddress,
        'India_Meter_Manufacture': IndiaMeterManufacture,
        'India_Meter_Model': IndiaMeterModel,
        'India_Service_Type': IndiaServiceType,
        'India_Measure_Unit': IndiaMeasureUnit,
        'Meter_Capacity': MeterCapacity,
        'India_Data_Collection_Frequency': IndiaDataCollectionFrequency,
        'Data_Collection_Frequency_Period': DataCollectionFrequencyPeriod,
        'Data_Collection_Frequency_Qty': DataCollectionFrequencyQty,
        'India_Link_AMR': IndiaLinkAMR,
        'AMR_Serial_No': AMRSerialNo,
        'Customer_First_Name': CustomerFirstName,
        'Customer_Last_Name': CustomerLastName,
        'Customer_Address': CustomerAddress,
        'Customer_Signature_Image': CustomerSignatureImage,
        'Customer_Signature_Date': CustomerSignatureDate,
        'Model_Type': ModelType,
        'Auto_Import_Code': AutoImportCode,
        'Manual_Meter_ID': ManualMeterID,
      };

}


class MetaData extends Decoder<MetaData> {
   List<MetaDataMeterType>? meterType;
   List<MetaDataServiceType>? serviceType;
   List<MetaDataARMs>? ARMs;
   List<MetaDataBPNumbers>? BPNumbers;
   List<MetaDataAddresses>? Addresses;
   List<MetaDataManufactures>? Manufactures;
   List<MetaDataModelTypes>? ModelTypes;
   List<MetaDataUnits>? Units;
   List<MetaDataCapacities>? Capacities;

  MetaData({
     this.meterType,
     this.serviceType,
     this.ARMs,
     this.BPNumbers,
     this.Addresses,
     this.Manufactures,
     this.ModelTypes,
     this.Units,
     this.Capacities,
  });

  factory MetaData.fromJson(Map<String, dynamic> json) => MetaData(
    meterType: (json['meterType'] as List?)?.map((e) => MetaDataMeterType.fromJson(e)).toList(),
    serviceType: (json['serviceType'] as List?)?.map((e) => MetaDataServiceType.fromJson(e)).toList(),
    ARMs: (json['ARMs'] as List?)?.map((e) => MetaDataARMs.fromJson(e)).toList(),
    BPNumbers: (json['BPNumbers'] as List?)?.map((e) => MetaDataBPNumbers.fromJson(e)).toList(),
    Addresses: (json['Addresses'] as List?)?.map((e) => MetaDataAddresses.fromJson(e)).toList(),
    Manufactures: (json['Manufactures'] as List?)?.map((e) => MetaDataManufactures.fromJson(e)).toList(),
    ModelTypes: (json['ModelTypes'] as List?)?.map((e) => MetaDataModelTypes.fromJson(e)).toList(),
    Units: (json['Units'] as List?)?.map((e) => MetaDataUnits.fromJson(e)).toList(),
    Capacities: (json['Capacities'] as List?)?.map((e) => MetaDataCapacities.fromJson(e)).toList(),
  );

  @override
  MetaData decode(Map<String, dynamic> json) => MetaData.fromJson(json);

  MetaData copyWith({
    List<MetaDataMeterType>? meterType,
    List<MetaDataServiceType>? serviceType,
    List<MetaDataARMs>? ARMs,
    List<MetaDataBPNumbers>? BPNumbers,
    List<MetaDataAddresses>? Addresses,
    List<MetaDataManufactures>? Manufactures,
    List<MetaDataModelTypes>? ModelTypes,
    List<MetaDataUnits>? Units,
    List<MetaDataCapacities>? Capacities,
  }) {
    return MetaData(
      meterType: meterType ?? this.meterType,
      serviceType: serviceType ?? this.serviceType,
      ARMs: ARMs ?? this.ARMs,
      BPNumbers: BPNumbers ?? this.BPNumbers,
      Addresses: Addresses ?? this.Addresses,
      Manufactures: Manufactures ?? this.Manufactures,
      ModelTypes: ModelTypes ?? this.ModelTypes,
      Units: Units ?? this.Units,
      Capacities: Capacities ?? this.Capacities,
    );
  }

  Map<String, dynamic> toJson() => {
        'meterType': meterType?.map((e) => e.toJson()).toList(),
        'serviceType': serviceType?.map((e) => e.toJson()).toList(),
        'ARMs': ARMs?.map((e) => e.toJson()).toList(),
        'BPNumbers': BPNumbers?.map((e) => e.toJson()).toList(),
        'Addresses': Addresses?.map((e) => e.toJson()).toList(),
        'Manufactures': Manufactures?.map((e) => e.toJson()).toList(),
        'ModelTypes': ModelTypes?.map((e) => e.toJson()).toList(),
        'Units': Units?.map((e) => e.toJson()).toList(),
        'Capacities': Capacities?.map((e) => e.toJson()).toList(),
      };

}
class MetaDataMeterType {
   String? ID;
   String? Name;

  MetaDataMeterType({
     this.ID,
     this.Name,
  });

  factory MetaDataMeterType.fromJson(Map<String, dynamic> json) => MetaDataMeterType(
    ID: (json['ID'] as String?)?.trim(),
    Name: (json['Name'] as String?)?.trim(),
  );

  MetaDataMeterType copyWith({
    String? ID,
    String? Name,
  }) {
    return MetaDataMeterType(
      ID: ID ?? this.ID,
      Name: Name ?? this.Name,
    );
  }

  Map<String, dynamic> toJson() => {
        'ID': ID,
        'Name': Name,
      };

}

class MetaDataServiceType {
   String? ID;
   String? Name;

  MetaDataServiceType({
     this.ID,
     this.Name,
  });

  factory MetaDataServiceType.fromJson(Map<String, dynamic> json) => MetaDataServiceType(
    ID: (json['ID'] as String?)?.trim(),
    Name: (json['Name'] as String?)?.trim(),
  );

  MetaDataServiceType copyWith({
    String? ID,
    String? Name,
  }) {
    return MetaDataServiceType(
      ID: ID ?? this.ID,
      Name: Name ?? this.Name,
    );
  }

  Map<String, dynamic> toJson() => {
        'ID': ID,
        'Name': Name,
      };

}

class MetaDataARMs {
   String? ID;
   String? Name;

  MetaDataARMs({
     this.ID,
     this.Name,
  });

  factory MetaDataARMs.fromJson(Map<String, dynamic> json) => MetaDataARMs(
    ID: (json['ID'] as String?)?.trim(),
    Name: (json['Name'] as String?)?.trim(),
  );

  MetaDataARMs copyWith({
    String? ID,
    String? Name,
  }) {
    return MetaDataARMs(
      ID: ID ?? this.ID,
      Name: Name ?? this.Name,
    );
  }

  Map<String, dynamic> toJson() => {
        'ID': ID,
        'Name': Name,
      };

}

class MetaDataBPNumbers {
   String? ID;
   String? Name;

  MetaDataBPNumbers({
     this.ID,
     this.Name,
  });

  factory MetaDataBPNumbers.fromJson(Map<String, dynamic> json) => MetaDataBPNumbers(
    ID: (json['ID'] as String?)?.trim(),
    Name: (json['Name'] as String?)?.trim(),
  );

  MetaDataBPNumbers copyWith({
    String? ID,
    String? Name,
  }) {
    return MetaDataBPNumbers(
      ID: ID ?? this.ID,
      Name: Name ?? this.Name,
    );
  }

  Map<String, dynamic> toJson() => {
        'ID': ID,
        'Name': Name,
      };

}

class MetaDataAddresses {
   String? ID;
   String? Name;

  MetaDataAddresses({
     this.ID,
     this.Name,
  });

  factory MetaDataAddresses.fromJson(Map<String, dynamic> json) => MetaDataAddresses(
    ID: (json['ID'] as String?)?.trim(),
    Name: (json['Name'] as String?)?.trim(),
  );

  MetaDataAddresses copyWith({
    String? ID,
    String? Name,
  }) {
    return MetaDataAddresses(
      ID: ID ?? this.ID,
      Name: Name ?? this.Name,
    );
  }

  Map<String, dynamic> toJson() => {
        'ID': ID,
        'Name': Name,
      };

}

class MetaDataManufactures {
   String? ID;
   String? Name;

  MetaDataManufactures({
     this.ID,
     this.Name,
  });

  factory MetaDataManufactures.fromJson(Map<String, dynamic> json) => MetaDataManufactures(
    ID: (json['ID'] as String?)?.trim(),
    Name: (json['Name'] as String?)?.trim(),
  );

  MetaDataManufactures copyWith({
    String? ID,
    String? Name,
  }) {
    return MetaDataManufactures(
      ID: ID ?? this.ID,
      Name: Name ?? this.Name,
    );
  }

  Map<String, dynamic> toJson() => {
        'ID': ID,
        'Name': Name,
      };

}

class MetaDataModelTypes {
   String? ID;
   String? Name;

  MetaDataModelTypes({
     this.ID,
     this.Name,
  });

  factory MetaDataModelTypes.fromJson(Map<String, dynamic> json) => MetaDataModelTypes(
    ID: (json['ID'] as String?)?.trim(),
    Name: (json['Name'] as String?)?.trim(),
  );

  MetaDataModelTypes copyWith({
    String? ID,
    String? Name,
  }) {
    return MetaDataModelTypes(
      ID: ID ?? this.ID,
      Name: Name ?? this.Name,
    );
  }

  Map<String, dynamic> toJson() => {
        'ID': ID,
        'Name': Name,
      };

}

class MetaDataUnits {
   String? ID;
   String? Name;

  MetaDataUnits({
     this.ID,
     this.Name,
  });

  factory MetaDataUnits.fromJson(Map<String, dynamic> json) => MetaDataUnits(
    ID: (json['ID'] as String?)?.trim(),
    Name: (json['Name'] as String?)?.trim(),
  );

  MetaDataUnits copyWith({
    String? ID,
    String? Name,
  }) {
    return MetaDataUnits(
      ID: ID ?? this.ID,
      Name: Name ?? this.Name,
    );
  }

  Map<String, dynamic> toJson() => {
        'ID': ID,
        'Name': Name,
      };

}

class MetaDataCapacities {
   String? ID;
   String? Name;

  MetaDataCapacities({
     this.ID,
     this.Name,
  });

  factory MetaDataCapacities.fromJson(Map<String, dynamic> json) => MetaDataCapacities(
    ID: (json['ID'] as String?)?.trim(),
    Name: (json['Name'] as String?)?.trim(),
  );

  MetaDataCapacities copyWith({
    String? ID,
    String? Name,
  }) {
    return MetaDataCapacities(
      ID: ID ?? this.ID,
      Name: Name ?? this.Name,
    );
  }

  Map<String, dynamic> toJson() => {
        'ID': ID,
        'Name': Name,
      };

}



class MeterReadingParam extends Decoder<MeterReadingParam> {
   num? MeterID;
   String? ReadingDate;
   String? ReadingTime;
   num? ReadingType;
   String? ReadingValue;
   num? DeliveredOrMovement;
   num? ReadingsOrDeliveries;
   String? NotePad;
   String? LocationNote;

  MeterReadingParam({
     this.MeterID,
     this.ReadingDate,
     this.ReadingTime,
     this.ReadingType,
     this.ReadingValue,
     this.DeliveredOrMovement,
     this.ReadingsOrDeliveries,
     this.NotePad,
     this.LocationNote,
  });

  factory MeterReadingParam.fromJson(Map<String, dynamic> json) => MeterReadingParam(
    MeterID: json['Meter_ID'] as num?,
    ReadingDate: (json['Reading_Date'] as String?)?.trim(),
    ReadingTime: (json['Reading_Time'] as String?)?.trim(),
    ReadingType: json['Reading_Type'] as num?,
    ReadingValue: (json['Reading_Value'] as String?)?.trim(),
    DeliveredOrMovement: json['Delivered_Or_Movement'] as num?,
    ReadingsOrDeliveries: json['Readings_Or_Deliveries'] as num?,
    NotePad: (json['NotePad'] as String?)?.trim(),
    LocationNote: (json['LocationNote'] as String?)?.trim(),
  );

  @override
  MeterReadingParam decode(Map<String, dynamic> json) => MeterReadingParam.fromJson(json);

  MeterReadingParam copyWith({
    num? MeterID,
    String? ReadingDate,
    String? ReadingTime,
    num? ReadingType,
    String? ReadingValue,
    num? DeliveredOrMovement,
    num? ReadingsOrDeliveries,
    String? NotePad,
    String? LocationNote,
  }) {
    return MeterReadingParam(
      MeterID: MeterID ?? this.MeterID,
      ReadingDate: ReadingDate ?? this.ReadingDate,
      ReadingTime: ReadingTime ?? this.ReadingTime,
      ReadingType: ReadingType ?? this.ReadingType,
      ReadingValue: ReadingValue ?? this.ReadingValue,
      DeliveredOrMovement: DeliveredOrMovement ?? this.DeliveredOrMovement,
      ReadingsOrDeliveries: ReadingsOrDeliveries ?? this.ReadingsOrDeliveries,
      NotePad: NotePad ?? this.NotePad,
      LocationNote: LocationNote ?? this.LocationNote,
    );
  }

  Map<String, dynamic> toJson() => {
        'Meter_ID': MeterID,
        'Reading_Date': ReadingDate,
        'Reading_Time': ReadingTime,
        'Reading_Type': ReadingType,
        'Reading_Value': ReadingValue,
        'Delivered_Or_Movement': DeliveredOrMovement,
        'Readings_Or_Deliveries': ReadingsOrDeliveries,
        'NotePad': NotePad,
        'LocationNote': LocationNote,
      };

}


class LastMeterReading extends Decoder<LastMeterReading> {
   num? MeterID;
   String? ReadingDate;
   String? ReadingTime;
   num? ReadingType;
   num? ReadingsOrDeliveries;
   num? ReadingValue;
   num? DeliveredOrMovement;
   String? NotePad;
   String? LocationNote;

  LastMeterReading({
     this.MeterID,
     this.ReadingDate,
     this.ReadingTime,
     this.ReadingType,
     this.ReadingsOrDeliveries,
     this.ReadingValue,
     this.DeliveredOrMovement,
     this.NotePad,
     this.LocationNote,
  });

  factory LastMeterReading.fromJson(Map<String, dynamic> json) => LastMeterReading(
    MeterID: json['Meter_ID'] as num?,
    ReadingDate: (json['Reading_Date'] as String?)?.trim(),
    ReadingTime: (json['Reading_Time'] as String?)?.trim(),
    ReadingType: json['Reading_Type'] as num?,
    ReadingsOrDeliveries: json['Readings_Or_Deliveries'] as num?,
    ReadingValue: json['Reading_Value'] as num?,
    DeliveredOrMovement: json['Delivered_Or_Movement'] as num?,
    NotePad: (json['NotePad'] as String?)?.trim(),
    LocationNote: (json['LocationNote'] as String?)?.trim(),
  );

  @override
  LastMeterReading decode(Map<String, dynamic> json) => LastMeterReading.fromJson(json);

  LastMeterReading copyWith({
    num? MeterID,
    String? ReadingDate,
    String? ReadingTime,
    num? ReadingType,
    num? ReadingsOrDeliveries,
    num? ReadingValue,
    num? DeliveredOrMovement,
    String? NotePad,
    String? LocationNote,
  }) {
    return LastMeterReading(
      MeterID: MeterID ?? this.MeterID,
      ReadingDate: ReadingDate ?? this.ReadingDate,
      ReadingTime: ReadingTime ?? this.ReadingTime,
      ReadingType: ReadingType ?? this.ReadingType,
      ReadingsOrDeliveries: ReadingsOrDeliveries ?? this.ReadingsOrDeliveries,
      ReadingValue: ReadingValue ?? this.ReadingValue,
      DeliveredOrMovement: DeliveredOrMovement ?? this.DeliveredOrMovement,
      NotePad: NotePad ?? this.NotePad,
      LocationNote: LocationNote ?? this.LocationNote,
    );
  }

  Map<String, dynamic> toJson() => {
        'Meter_ID': MeterID,
        'Reading_Date': ReadingDate,
        'Reading_Time': ReadingTime,
        'Reading_Type': ReadingType,
        'Readings_Or_Deliveries': ReadingsOrDeliveries,
        'Reading_Value': ReadingValue,
        'Delivered_Or_Movement': DeliveredOrMovement,
        'NotePad': NotePad,
        'LocationNote': LocationNote,
      };

}


class Uploads extends Decoder<Uploads> {
   List<UploadsSuccess>? Success;

  Uploads({
     this.Success,
  });

  factory Uploads.fromJson(Map<String, dynamic> json) => Uploads(
    Success: (json['Success'] as List?)?.map((e) => UploadsSuccess.fromJson(e)).toList(),
  );

  @override
  Uploads decode(Map<String, dynamic> json) => Uploads.fromJson(json);

  Uploads copyWith({
    List<UploadsSuccess>? Success,
  }) {
    return Uploads(
      Success: Success ?? this.Success,
    );
  }

  Map<String, dynamic> toJson() => {
        'Success': Success?.map((e) => e.toJson()).toList(),
      };

}
class UploadsSuccess {
   String? Image;

  UploadsSuccess({
     this.Image,
  });

  factory UploadsSuccess.fromJson(Map<String, dynamic> json) => UploadsSuccess(
    Image: (json['Image'] as String?)?.trim(),
  );

  UploadsSuccess copyWith({
    String? Image,
  }) {
    return UploadsSuccess(
      Image: Image ?? this.Image,
    );
  }

  Map<String, dynamic> toJson() => {
        'Image': Image,
      };

}



class SearchDevEUI extends Decoder<SearchDevEUI> {
   List<SearchDevEUIAmrs>? amrs;

  SearchDevEUI({
     this.amrs,
  });

  factory SearchDevEUI.fromJson(Map<String, dynamic> json) => SearchDevEUI(
    amrs: (json['amrs'] as List?)?.map((e) => SearchDevEUIAmrs.fromJson(e)).toList(),
  );

  @override
  SearchDevEUI decode(Map<String, dynamic> json) => SearchDevEUI.fromJson(json);

  SearchDevEUI copyWith({
    List<SearchDevEUIAmrs>? amrs,
  }) {
    return SearchDevEUI(
      amrs: amrs ?? this.amrs,
    );
  }

  Map<String, dynamic> toJson() => {
        'amrs': amrs?.map((e) => e.toJson()).toList(),
      };

}
class SearchDevEUIAmrs {
   String? ID;
   String? Name;

  SearchDevEUIAmrs({
     this.ID,
     this.Name,
  });

  factory SearchDevEUIAmrs.fromJson(Map<String, dynamic> json) => SearchDevEUIAmrs(
    ID: (json['ID'] as String?)?.trim(),
    Name: (json['Name'] as String?)?.trim(),
  );

  SearchDevEUIAmrs copyWith({
    String? ID,
    String? Name,
  }) {
    return SearchDevEUIAmrs(
      ID: ID ?? this.ID,
      Name: Name ?? this.Name,
    );
  }

  Map<String, dynamic> toJson() => {
        'ID': ID,
        'Name': Name,
      };

}



class GetAddressDetail extends Decoder<GetAddressDetail> {
   num? MeterID;
   num? TenantMeterID;
   String? Name;
   String? DrsNo;
   String? FlatNo;
   String? PlotNo;
   String? FloorNo;
   String? WingName;
   String? RoadName;
   String? Landmark;
   String? Colony;
   String? Location;
   String? District;
   String? City;
   String? Postcode;
   String? Country;
   String? Address;
   String? Address1;
   String? Address2;
   String? ContactNumber;
   String? BuildingName;
   String? SocietyName;
   String? FromDate;
   String? ToDate;
   String? CreatedOn;
   bool? IsUnoccupied;

  GetAddressDetail({
     this.MeterID,
     this.TenantMeterID,
     this.Name,
     this.DrsNo,
     this.FlatNo,
     this.PlotNo,
     this.FloorNo,
     this.WingName,
     this.RoadName,
     this.Landmark,
     this.Colony,
     this.Location,
     this.District,
     this.City,
     this.Postcode,
     this.Country,
     this.Address,
     this.Address1,
     this.Address2,
     this.ContactNumber,
     this.BuildingName,
     this.SocietyName,
     this.FromDate,
     this.ToDate,
     this.CreatedOn,
     this.IsUnoccupied,
  });

  factory GetAddressDetail.fromJson(Map<String, dynamic> json) => GetAddressDetail(
    MeterID: json['Meter_ID'] as num?,
    TenantMeterID: json['Tenant_Meter_ID'] as num?,
    Name: (json['Name'] as String?)?.trim(),
    DrsNo: (json['Drs_No'] as String?)?.trim(),
    FlatNo: (json['Flat_No'] as String?)?.trim(),
    PlotNo: (json['Plot_No'] as String?)?.trim(),
    FloorNo: (json['Floor_No'] as String?)?.trim(),
    WingName: (json['Wing_Name'] as String?)?.trim(),
    RoadName: (json['Road_Name'] as String?)?.trim(),
    Landmark: (json['Landmark'] as String?)?.trim(),
    Colony: (json['Colony'] as String?)?.trim(),
    Location: (json['Location'] as String?)?.trim(),
    District: (json['District'] as String?)?.trim(),
    City: (json['City'] as String?)?.trim(),
    Postcode: (json['Postcode'] as String?)?.trim(),
    Country: (json['Country'] as String?)?.trim(),
    Address: (json['Address'] as String?)?.trim(),
    Address1: (json['Address1'] as String?)?.trim(),
    Address2: (json['Address2'] as String?)?.trim(),
    ContactNumber: (json['Contact_Number'] as String?)?.trim(),
    BuildingName: (json['Building_Name'] as String?)?.trim(),
    SocietyName: (json['Society_Name'] as String?)?.trim(),
    FromDate: (json['FromDate'] as String?)?.trim(),
    ToDate: (json['ToDate'] as String?)?.trim(),
    CreatedOn: (json['Created_On'] as String?)?.trim(),
    IsUnoccupied: json['IsUnoccupied'] as bool?,
  );

  @override
  GetAddressDetail decode(Map<String, dynamic> json) => GetAddressDetail.fromJson(json);

  GetAddressDetail copyWith({
    num? MeterID,
    num? TenantMeterID,
    String? Name,
    String? DrsNo,
    String? FlatNo,
    String? PlotNo,
    String? FloorNo,
    String? WingName,
    String? RoadName,
    String? Landmark,
    String? Colony,
    String? Location,
    String? District,
    String? City,
    String? Postcode,
    String? Country,
    String? Address,
    String? Address1,
    String? Address2,
    String? ContactNumber,
    String? BuildingName,
    String? SocietyName,
    String? FromDate,
    String? ToDate,
    String? CreatedOn,
    bool? IsUnoccupied,
  }) {
    return GetAddressDetail(
      MeterID: MeterID ?? this.MeterID,
      TenantMeterID: TenantMeterID ?? this.TenantMeterID,
      Name: Name ?? this.Name,
      DrsNo: DrsNo ?? this.DrsNo,
      FlatNo: FlatNo ?? this.FlatNo,
      PlotNo: PlotNo ?? this.PlotNo,
      FloorNo: FloorNo ?? this.FloorNo,
      WingName: WingName ?? this.WingName,
      RoadName: RoadName ?? this.RoadName,
      Landmark: Landmark ?? this.Landmark,
      Colony: Colony ?? this.Colony,
      Location: Location ?? this.Location,
      District: District ?? this.District,
      City: City ?? this.City,
      Postcode: Postcode ?? this.Postcode,
      Country: Country ?? this.Country,
      Address: Address ?? this.Address,
      Address1: Address1 ?? this.Address1,
      Address2: Address2 ?? this.Address2,
      ContactNumber: ContactNumber ?? this.ContactNumber,
      BuildingName: BuildingName ?? this.BuildingName,
      SocietyName: SocietyName ?? this.SocietyName,
      FromDate: FromDate ?? this.FromDate,
      ToDate: ToDate ?? this.ToDate,
      CreatedOn: CreatedOn ?? this.CreatedOn,
      IsUnoccupied: IsUnoccupied ?? this.IsUnoccupied,
    );
  }

  Map<String, dynamic> toJson() => {
        'Meter_ID': MeterID,
        'Tenant_Meter_ID': TenantMeterID,
        'Name': Name,
        'Drs_No': DrsNo,
        'Flat_No': FlatNo,
        'Plot_No': PlotNo,
        'Floor_No': FloorNo,
        'Wing_Name': WingName,
        'Road_Name': RoadName,
        'Landmark': Landmark,
        'Colony': Colony,
        'Location': Location,
        'District': District,
        'City': City,
        'Postcode': Postcode,
        'Country': Country,
        'Address': Address,
        'Address1': Address1,
        'Address2': Address2,
        'Contact_Number': ContactNumber,
        'Building_Name': BuildingName,
        'Society_Name': SocietyName,
        'FromDate': FromDate,
        'ToDate': ToDate,
        'Created_On': CreatedOn,
        'IsUnoccupied': IsUnoccupied,
      };

}


class UpdateAddress extends Decoder<UpdateAddress> {
   String? message;

  UpdateAddress({
     this.message,
  });

  factory UpdateAddress.fromJson(Map<String, dynamic> json) => UpdateAddress(
    message: (json['message'] as String?)?.trim(),
  );

  @override
  UpdateAddress decode(Map<String, dynamic> json) => UpdateAddress.fromJson(json);

  UpdateAddress copyWith({
    String? message,
  }) {
    return UpdateAddress(
      message: message ?? this.message,
    );
  }

  Map<String, dynamic> toJson() => {
        'message': message,
      };

}



