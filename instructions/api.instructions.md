---
applyTo: '**'
---


# 🧠 Instructions for Copilot Agency for using API
1. APIClient
   - Use the `APIClient` class located in `lib/core/api/api_client.dart` for all API requests.
   - Always get the `APIClient` instance from the `getIt` service locator 
   ```dart
     final APIClient _apiClient =GetIt.I<ManagerEnvService>().apiClient;
   ```
   - Do not create a new instance of `APIClient` directly.
   **How to use API CLient with single-response**:
   ```dart
    final response = await _apiClient.request<APIResponse<MetaData>>(
      option: MainRouteApiRoutesGenerated.metaData(),
      create: (res) => APIResponse<MetaData>(originalResponse: res,decodedData: MetaData()),
    );
    final data = response.decodedData;
    return data;
   ```
   **How to use API CLient with list-response**:
   ```dart
    final APIListResponse<MetaData> response = await _apiClient.request< APIListResponse<MetaData>>(
      option: MainRouteApiRoutesGenerated.metaData(),
      create: (res) => APIListResponse<MetaData>(originalResponse: res,decodedData: MetaData()),
    );
    return response;
   ```
   - The model for each API response should be generated from this steps:
    1. Import the response model to the api_routes.json
    2. Run `make gen_api` to generate the API routes and models.
    3. Use that model in the API call as the `create` parameter in the `decodedData` method.
    4. Return the decoded data(generated model) from the API call.
    5. The decodedData model should get from `lib/core/api/api_routes/api_routes_generated.dart` file.
       and it should closely work with the repos to return the exact data.
       Do not create a new model for parsing the API response. Use the generated model.
