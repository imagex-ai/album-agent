"""Strict, opt-in subset validation for Profile Hub operations."""


def filter_profile_album_subset(album, selected_urls):
    """Return exactly the selected originals, or fail without broadening scope.

    Profile Hub selections use original URLs rather than session/index IDs. An
    ambiguous duplicate URL and a stale URL are both failures, not a request
    to save the complete album. This helper does not mutate the source album.
    """
    requested = [str(url).strip() for url in (selected_urls or [])]
    if not requested or any(not url for url in requested) or len(set(requested)) != len(requested):
        raise ValueError("Profile album selection must contain unique, nonempty URLs")

    images_by_url = {}
    for image in album.images:
        url = str(getattr(image, "original_url", "") or "").strip()
        if url in requested:
            if url in images_by_url:
                raise ValueError("Profile album selection contains an ambiguous URL")
            images_by_url[url] = image
    if len(images_by_url) != len(requested):
        raise ValueError("Profile album selection no longer matches the album")

    result = album.model_copy(deep=True)
    result.images = [images_by_url[url].model_copy(deep=True) for url in requested]
    for index, image in enumerate(result.images, 1):
        image.position = index
    result.cover_image_url = result.images[0].thumbnail_url or result.images[0].original_url or result.cover_image_url
    if getattr(result, "telemetry", None):
        result.telemetry.originals_resolved = len(result.images)
    result.metadata["custom_selected_count"] = len(result.images)
    result.metadata["original_total_count"] = len(album.images)
    result.metadata["is_subset_selection"] = len(result.images) < len(album.images)
    return result
