"""Lightweight matching fields for Web Stream batches, without cached library state."""


class StreamRegistrationLookup:
    def __init__(self, video_service):
        self.video_service = video_service

    def list_videos(self):
        # Both metadata and filesystem discovery stay fresh on every call.
        try:
            return self.video_service.list_all_videos(_registration_only=True)
        except Exception:
            # Keep the established lookup available if the lightweight path fails.
            return self.video_service.list_all_videos()
