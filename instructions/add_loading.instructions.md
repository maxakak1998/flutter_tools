---
applyTo: '**'
---


# 🧠 Instructions for Copilot Agency for adding loading effect

1. Review the cubit structure and state management approach used in your project.
2. Use the cubit's state to determine when loading is in progress, when an operation succeeds, and when an error occurs.
3. Integrate loading, success, and error overlays using `CommonLoadingWidget` in the appropriate cubit state callbacks (`onLoading`, `onSucceed`, `onError`).
4. Ensure that loading overlays are shown at the start of an operation and dismissed on completion (success or error).
5. Display context-specific messages for different operations to improve user feedback.

Usage Example:
```dart
  body: CustomCubit(
          bloc: _cubit,
          onSucceed: (state) async {
            // Hide loading overlay for any successful operation
            CommonLoadingWidget.dismiss();
            _clearCurrentOperation();
            
            if (state is MainSetupPhotoState) {
              // Handle photo upload success - only show message when photo upload completes
              if (!state.isUploadingPhoto && state.uploadingImagePath != null) {
                CommonLoadingWidget.showSuccess('Photo uploaded successfully');
              }
            } else if (state is MainSetupPhotoUploadState ) {
              // Handle photo upload success
              CommonLoadingWidget.showSuccess('Photo uploaded successfully');
            }
          },
          onError: (state) async {
            // Hide loading overlay and show error for any failed operation
            CommonLoadingWidget.dismiss();
            
            if (state is MainSetupPhotoState) {
              CommonLoadingWidget.showError(state.error ?? 'Photo upload failed');
            } else if (state is MainSetupPhotoUploadState && state.state == EventState.error) {
              CommonLoadingWidget.showError('Failed to upload photo: ${state.error}');
            } 
          },
          onLoading: (state) {
            
            if (state is MainSetupInitState && state.state == EventState.loading) {
              
              final message = _getLoadingMessage();
              CommonLoadingWidget.showSaveLoading(message: message);
              
            } else if (state is MainSetupFieldApiUpdateState && state.state == EventState.loading) {
              CommonLoadingWidget.showSaveLoading(message: 'Updating $fieldName...');
              
            } else if (state is MainSetupPhotoState && state.isUploadingPhoto) {
              final fileName = state.uploadingImagePath?.split('/').last ?? 'photo';
              CommonLoadingWidget.show(message: 'Uploading $fileName...');
            } 
            
            return true;
          },
          builder: (context, state, isLoading) {
            return SingleChildScrollView(
              padding: EdgeInsets.all(16.w),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _buildMeterNameSection(currentTheme),
                  SizedBox(height: 24.h),
                  _buildExtraFieldsSection(currentTheme),
                  SizedBox(height: 24.h),
                  EnhancedNotesWidget(
                    noteController: _noteController,
                    locationNoteController: _locationNoteController,
                    onChanged: _handleNotesChanged,
                    onCleared: _handleNotesCleared, // Add callback for clear and add operations
                    noteTitle: 'Notepad',
                    locationNoteTitle: 'Location Note',
                    noteHint: 'Add notes about the meter setup...',
                    locationNoteHint: 'Add notes about the meter location...',
                    margin: EdgeInsets.symmetric(
                      vertical: 8.h,
                    ), // Only vertical margin for width consistency
                  ),
                  SizedBox(height: 24.h),
                  _buildPhotosSection(currentTheme),
                  SizedBox(height: 32.h),
                  _buildNextButton(currentTheme),
                ],
              ),
            );
          },
        ),
      );
```