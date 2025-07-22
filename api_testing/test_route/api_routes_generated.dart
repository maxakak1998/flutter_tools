// GENERATED CODE - DO NOT MODIFY BY HAND

import 'package:dio/dio.dart';
import 'package:data_entry/core/api/decodable.dart';

// === RequestOptions Generator ===
class TestRouteApiRoutesGenerated {
  // Helper function to remove null values from maps
  static Map<String, dynamic> _removeNullValues(Map<String, dynamic> map) {
    final result = <String, dynamic>{};
    map.forEach((key, value) {
      if (value != null && value != '') {
        if (value is Map<String, dynamic>) {
          final cleanedMap = _removeNullValues(value);
          if (cleanedMap.isNotEmpty) {
            result[key] = cleanedMap;
          }
        } else if (value is List) {
          final cleanedList = value.where((item) => item != null && item != '').toList();
          if (cleanedList.isNotEmpty) {
            result[key] = cleanedList;
          }
        } else {
          result[key] = value;
        }
      }
    });
    return result;
  }

  static RequestOptions create_user({BaseOptions? baseOption, required CreateUserFullName fullName, required List<CreateUserContactsItem> contacts, required List<String> emails, required CreateUserFactorys factorys, required bool isResulted, required bool onlyCount}) {
    baseOption??= BaseOptions();
    final options = Options(
      method: 'POST',
      headers: {"Content-Type":"application/json"},
      extra: {
        "requiresAuth": true,
      },
    ).compose(baseOption, '/api/users', data: _removeNullValues({"full_name": fullName?.toJson(), "contacts": contacts.map((e) => e.toJson()).toList(), "emails": emails.map((e) => e.toJson()).toList(), "factorys": factorys?.toJson()}), queryParameters: _removeNullValues({"isResulted": isResulted, "onlyCount": onlyCount}));
    return options;
  }

}


// === Models ===
class CreateUserFullName {
   String? surname;

  CreateUserFullName({
     this.surname,
  });

  factory CreateUserFullName.fromJson(Map<String, dynamic> json) => CreateUserFullName(
    surname: (json['surname'] as String?)?.trim(),
  );

  CreateUserFullName copyWith({
    String? surname,
  }) {
    return CreateUserFullName(
      surname: surname ?? this.surname,
    );
  }

  Map<String, dynamic> toJson() => {
        'surname': surname,
      };

}


class CreateUserContactsItem {
   String type;

  CreateUserContactsItem({
     required this.type,
  });

  factory CreateUserContactsItem.fromJson(Map<String, dynamic> json) => CreateUserContactsItem(
    type: (json['type'] as String).trim(),
  );

  CreateUserContactsItem copyWith({
    String? type,
  }) {
    return CreateUserContactsItem(
      type: type ?? this.type,
    );
  }

  Map<String, dynamic> toJson() => {
        'type': type,
      };

}


class CreateUserFactorys {
   String sourceName;

  CreateUserFactorys({
     required this.sourceName,
  });

  factory CreateUserFactorys.fromJson(Map<String, dynamic> json) => CreateUserFactorys(
    sourceName: (json['source_name'] as String).trim(),
  );

  CreateUserFactorys copyWith({
    String? sourceName,
  }) {
    return CreateUserFactorys(
      sourceName: sourceName ?? this.sourceName,
    );
  }

  Map<String, dynamic> toJson() => {
        'source_name': sourceName,
      };

}


class CreateUser extends Decoder<CreateUser> {
   String fullName;
   List<CreateUserPhoneNumbersItem>? phoneNumbers;
   CreateUserContactInfo contactInfo;
   num? age;
   bool? isActive;

  CreateUser({
     required this.fullName,
     this.phoneNumbers,
     required this.contactInfo,
     this.age,
     this.isActive,
  });

  factory CreateUser.fromJson(Map<String, dynamic> json) => CreateUser(
    fullName: (json['full_name'] as String).trim(),
    phoneNumbers: (json['phone_numbers'] as List?)?.map((e) => CreateUserPhoneNumbersItem.fromJson(e)).toList(),
    contactInfo: CreateUserContactInfo.fromJson(json['contact_info'] as Map<String, dynamic>),
    age: json['age'] as num?,
    isActive: json['is_active'] as bool?,
  );

  @override
  CreateUser decode(Map<String, dynamic> json) => CreateUser.fromJson(json);

  CreateUser copyWith({
    String? fullName,
    List<CreateUserPhoneNumbersItem>? phoneNumbers,
    CreateUserContactInfo? contactInfo,
    num? age,
    bool? isActive,
  }) {
    return CreateUser(
      fullName: fullName ?? this.fullName,
      phoneNumbers: phoneNumbers ?? this.phoneNumbers,
      contactInfo: contactInfo ?? this.contactInfo,
      age: age ?? this.age,
      isActive: isActive ?? this.isActive,
    );
  }

  Map<String, dynamic> toJson() => {
        'full_name': fullName,
        'phone_numbers': phoneNumbers?.map((e) => e.toJson()).toList(),
        'contact_info': contactInfo?.toJson(),
        'age': age,
        'is_active': isActive,
      };

}

class CreateUserPhoneNumbersItem {
   String phoneType;
   String? countryCode;
   String number;
   bool isPrimary;

  CreateUserPhoneNumbersItem({
     required this.phoneType,
     this.countryCode,
     required this.number,
     required this.isPrimary,
  });

  factory CreateUserPhoneNumbersItem.fromJson(Map<String, dynamic> json) => CreateUserPhoneNumbersItem(
    phoneType: (json['phone_type'] as String).trim(),
    countryCode: (json['country_code'] as String?)?.trim(),
    number: (json['number'] as String).trim(),
    isPrimary: json['is_primary'] as bool,
  );

  CreateUserPhoneNumbersItem copyWith({
    String? phoneType,
    String? countryCode,
    String? number,
    bool? isPrimary,
  }) {
    return CreateUserPhoneNumbersItem(
      phoneType: phoneType ?? this.phoneType,
      countryCode: countryCode ?? this.countryCode,
      number: number ?? this.number,
      isPrimary: isPrimary ?? this.isPrimary,
    );
  }

  Map<String, dynamic> toJson() => {
        'phone_type': phoneType,
        'country_code': countryCode,
        'number': number,
        'is_primary': isPrimary,
      };

}


class CreateUserContactInfoSocialAccountsItemProfileData {
   String displayName;
   String? bio;
   num? followerCount;

  CreateUserContactInfoSocialAccountsItemProfileData({
     required this.displayName,
     this.bio,
     this.followerCount,
  });

  factory CreateUserContactInfoSocialAccountsItemProfileData.fromJson(Map<String, dynamic> json) => CreateUserContactInfoSocialAccountsItemProfileData(
    displayName: (json['display_name'] as String).trim(),
    bio: (json['bio'] as String?)?.trim(),
    followerCount: json['follower_count'] as num?,
  );

  CreateUserContactInfoSocialAccountsItemProfileData copyWith({
    String? displayName,
    String? bio,
    num? followerCount,
  }) {
    return CreateUserContactInfoSocialAccountsItemProfileData(
      displayName: displayName ?? this.displayName,
      bio: bio ?? this.bio,
      followerCount: followerCount ?? this.followerCount,
    );
  }

  Map<String, dynamic> toJson() => {
        'display_name': displayName,
        'bio': bio,
        'follower_count': followerCount,
      };

}


class CreateUserContactInfoSocialAccountsItem {
   String platform;
   String username;
   CreateUserContactInfoSocialAccountsItemProfileData profileData;

  CreateUserContactInfoSocialAccountsItem({
     required this.platform,
     required this.username,
     required this.profileData,
  });

  factory CreateUserContactInfoSocialAccountsItem.fromJson(Map<String, dynamic> json) => CreateUserContactInfoSocialAccountsItem(
    platform: (json['platform'] as String).trim(),
    username: (json['username'] as String).trim(),
    profileData: CreateUserContactInfoSocialAccountsItemProfileData.fromJson(json['profile_data'] as Map<String, dynamic>),
  );

  CreateUserContactInfoSocialAccountsItem copyWith({
    String? platform,
    String? username,
    CreateUserContactInfoSocialAccountsItemProfileData? profileData,
  }) {
    return CreateUserContactInfoSocialAccountsItem(
      platform: platform ?? this.platform,
      username: username ?? this.username,
      profileData: profileData ?? this.profileData,
    );
  }

  Map<String, dynamic> toJson() => {
        'platform': platform,
        'username': username,
        'profile_data': profileData?.toJson(),
      };

}


class CreateUserContactInfo {
   List<String>? additionalEmails;
   List<CreateUserContactInfoSocialAccountsItem>? socialAccounts;
   String primaryEmail;
   String? backupEmail;

  CreateUserContactInfo({
     this.additionalEmails,
     this.socialAccounts,
     required this.primaryEmail,
     this.backupEmail,
  });

  factory CreateUserContactInfo.fromJson(Map<String, dynamic> json) => CreateUserContactInfo(
    additionalEmails: (json['additional_emails'] as List?)?.map((e) => (e as String).trim()).toList(),
    socialAccounts: (json['social_accounts'] as List?)?.map((e) => CreateUserContactInfoSocialAccountsItem.fromJson(e)).toList(),
    primaryEmail: (json['primary_email'] as String).trim(),
    backupEmail: (json['backup_email'] as String?)?.trim(),
  );

  CreateUserContactInfo copyWith({
    List<String>? additionalEmails,
    List<CreateUserContactInfoSocialAccountsItem>? socialAccounts,
    String? primaryEmail,
    String? backupEmail,
  }) {
    return CreateUserContactInfo(
      additionalEmails: additionalEmails ?? this.additionalEmails,
      socialAccounts: socialAccounts ?? this.socialAccounts,
      primaryEmail: primaryEmail ?? this.primaryEmail,
      backupEmail: backupEmail ?? this.backupEmail,
    );
  }

  Map<String, dynamic> toJson() => {
        'additional_emails': additionalEmails,
        'social_accounts': socialAccounts?.map((e) => e.toJson()).toList(),
        'primary_email': primaryEmail,
        'backup_email': backupEmail,
      };

}




