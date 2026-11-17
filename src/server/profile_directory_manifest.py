"""Typed, side-effect-free directory contracts and source-specific HTML adapters.

This module never imports the application, profile scanners, or library services.
An adapter recognizes supported routes AND verifies the returned listing structure.
"""
from __future__ import annotations

import hashlib
import re
from typing import Literal, Protocol
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

from bs4 import BeautifulSoup
from pydantic import BaseModel, ConfigDict, Field


class DirectoryInputError(ValueError):
    """The requested URL is outside an adapter's supported capabilities."""


class DirectoryStructureError(ValueError):
    """A successful HTTP response did not contain the expected directory."""


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ProfileEntry(ContractModel):
    key: str
    source_url: str
    name: str | None = None
    image_url: str | None = None
    description: str | None = None
    rank: int | None = Field(default=None, ge=1)
    video_count: int | None = Field(default=None, ge=0)
    photo_count: int | None = Field(default=None, ge=0)
    album_count: int | None = Field(default=None, ge=0)
    provenance_page_url: str
    gender: Literal["female", "male", "trans"] | None = None


class PageLink(ContractModel):
    url: str
    page: int = Field(ge=1)


class DirectoryPagination(ContractModel):
    current_page: int = Field(ge=1)
    links: list[PageLink] = Field(default_factory=list)
    previous_url: str | None = None
    next_url: str | None = None
    has_more: bool | None = None
    reported_total: int | None = None


class FilterChoice(ContractModel):
    value: str
    label: str


class SourceFilter(ContractModel):
    name: str
    kind: Literal["choice", "number"]
    multiple: bool = False
    choices: list[FilterChoice] = Field(default_factory=list)
    minimum: int | None = None
    maximum: int | None = None


class DirectoryCapabilities(ContractModel):
    all_url: str | None = None
    query_url: str | None = None
    active_letter: str | None = None
    active_category: str | None = None
    alphabet_links: dict[str, str] = Field(default_factory=dict)
    category_links: dict[str, str] = Field(default_factory=dict)
    remote_filters: list[SourceFilter] = Field(default_factory=list)
    name_search_scope: Literal["loaded_profiles"] = "loaded_profiles"
    source_order: Literal["rank", "source"] = "source"
    local_sort_fields: list[str] = Field(default_factory=lambda: ["name"])


class DirectoryPage(ContractModel):
    contract_version: Literal[1] = 1
    adapter_id: str
    directory_key: str
    query_key: str
    source_url: str
    page_url: str
    items: list[ProfileEntry]
    loaded_count: int
    page_complete: bool = True
    # A fetched page is not proof that all directory pages have been discovered.
    directory_complete: bool = False
    pagination: DirectoryPagination
    capabilities: DirectoryCapabilities
    warnings: list[str] = Field(default_factory=list)


class DirectoryAdapter(Protocol):
    adapter_id: str

    def normalize_url(self, url: str, *, kind: str = "directory") -> str: ...
    def recognize(self, url: str) -> Literal["directory", "profile"] | None: ...
    def context_url(self, url: str) -> str: ...
    def parse(self, url: str, html: str) -> DirectoryPage: ...


def stable_key(adapter_id: str, url: str) -> str:
    return adapter_id + ":" + hashlib.sha256(url.encode("utf-8")).hexdigest()


def _merge_context_query(base: str, href: str) -> str:
    base_parts = urlsplit(base)
    joined = urljoin(base, href)
    joined_parts = urlsplit(joined)
    base_pairs = [(k, v) for k, v in parse_qsl(base_parts.query, keep_blank_values=True) if k != "page"]
    joined_pairs = [(k, v) for k, v in parse_qsl(joined_parts.query, keep_blank_values=True)]
    joined_keys = set(k for k, _ in joined_pairs)
    merged = list(joined_pairs)
    for k, v in base_pairs:
        if k not in joined_keys:
            merged.append((k, v))
    query = urlencode(sorted(set(merged)))
    return urlunsplit((joined_parts.scheme, joined_parts.netloc, joined_parts.path, query, ""))


class EpornerDirectoryAdapter:
    adapter_id = "eporner"
    hosts = frozenset({"eporner.com", "www.eporner.com"})
    directory_path = re.compile(
        r"/pornstar-list(?:/(?P<category>female|male))?"
        r"(?:/(?P<letter>[A-Z]))?(?:/(?P<page>[1-9][0-9]{0,5}))?/?\Z"
    )
    profile_path = re.compile(r"/pornstar/[A-Za-z0-9_-]+/?\Z")
    number_filters = frozenset(
        f"{dimension}_{suffix}"
        for dimension in ("age", "height", "bust", "waist", "hips")
        for suffix in ("from", "to", "scale_min", "scale_max")
    )
    choice_filters = frozenset({"unit", "cup[]", "hair[]", "country[]", "ethnicity[]", "eye[]"})

    def normalize_url(self, url: str, *, kind: str = "directory") -> str:
        if not isinstance(url, str) or len(url) > 4096 or any(ord(c) < 33 for c in url):
            raise DirectoryInputError("invalid_url")
        try:
            parts = urlsplit(url)
            valid_origin = (
                parts.scheme == "https" and parts.hostname in self.hosts
                and parts.port in (None, 443) and not parts.username and not parts.password
                and not parts.fragment and "\\" not in url
            )
        except ValueError as exc:
            raise DirectoryInputError("invalid_url") from exc
        if not valid_origin:
            raise DirectoryInputError("unsupported_origin")
        pattern = self.directory_path if kind == "directory" else self.profile_path
        if not pattern.fullmatch(parts.path):
            raise DirectoryInputError("unsupported_route")
        try:
            pairs = parse_qsl(parts.query, keep_blank_values=True, max_num_fields=48, errors="strict")
        except (ValueError, UnicodeError) as exc:
            raise DirectoryInputError("invalid_filters") from exc
        if kind == "profile" and pairs:
            raise DirectoryInputError("unsupported_profile_query")
        seen = set()
        for key, value in pairs:
            if key in self.number_filters:
                if not re.fullmatch(r"[0-9]{1,4}", value) or int(value) > 1000:
                    raise DirectoryInputError("invalid_numeric_filter")
            elif key in self.choice_filters:
                if not re.fullmatch(r"[A-Za-z0-9 _-]{0,64}", value):
                    raise DirectoryInputError("invalid_choice_filter")
            else:
                raise DirectoryInputError("unsupported_filter")
            if key in seen and not key.endswith("[]"):
                raise DirectoryInputError("duplicate_filter")
            seen.add(key)
        # Bare/www aliases and trailing slash are known equivalents; slugs are not.
        path = parts.path.rstrip("/") + "/"
        if kind == "directory":
            match = self.directory_path.fullmatch(path)
            if match and match["page"] == "1":
                path = path[:-2]
        query = urlencode(sorted(set(pairs)))
        return urlunsplit(("https", "www.eporner.com", path, query, ""))

    def recognize(self, url: str) -> Literal["directory", "profile"] | None:
        for kind in ("directory", "profile"):
            try:
                self.normalize_url(url, kind=kind)
                return kind
            except DirectoryInputError:
                continue
        return None

    def context_url(self, url: str) -> str:
        normalized = self.normalize_url(url)
        parts = urlsplit(normalized)
        match = self.directory_path.fullmatch(parts.path)
        path = parts.path
        if match["page"]:
            path = path[:-(len(match["page"]) + 1)]
        return urlunsplit((parts.scheme, parts.netloc, path, parts.query, ""))

    def page_number(self, url: str) -> int:
        return int(self.directory_path.fullmatch(urlsplit(url).path)["page"] or 1)

    def _linked_directory(self, base: str, href: str, *, same_context: bool) -> str | None:
        try:
            target = _merge_context_query(base, href) if same_context else urljoin(base, href)
            url = self.normalize_url(target)
        except (ValueError, DirectoryInputError):
            return None
        if same_context and self.context_url(url) != self.context_url(base):
            return None
        return url

    @staticmethod
    def _count(card, label: str) -> int | None:
        # Source class names are misleading: mbvie currently means Photos.
        for node in card.select(".mbtim, .mbvie"):
            match = re.fullmatch(rf"{label}\s*:\s*([0-9]+(?:[ ,][0-9]{{3}})*)", node.get_text(" ", strip=True), re.I)
            if match:
                digits = re.sub(r"[ ,]", "", match[1])
                if len(digits) <= 18:
                    return int(digits)
        return None

    @staticmethod
    def _image(base: str, card) -> str | None:
        img = card.find("img")
        if img is None:
            return None
        for attr in ("data-src", "data-original", "data-lazy-src", "src"):
            raw = (img.get(attr) or "").strip()
            if not raw or raw.startswith("data:") or any(x in raw.lower() for x in ("blank.gif", "placeholder", "transparent.gif")):
                continue
            try:
                candidate = urljoin(base, raw)
                parts = urlsplit(candidate)
                safe = (parts.scheme == "https" and parts.hostname
                        and (parts.hostname == "eporner.com" or parts.hostname.endswith(".eporner.com"))
                        and parts.port in (None, 443) and not parts.username and not parts.password)
            except ValueError:
                safe = False
            if safe:
                return urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ""))
        return None

    def parse(self, url: str, html: str) -> DirectoryPage:
        url = self.normalize_url(url)
        soup = BeautifulSoup(html, "html.parser")
        container = soup.select_one(".pornstar-list-results")
        if container is None:
            raise DirectoryStructureError("directory_structure_not_found")
        warnings = []
        profiles: dict[str, ProfileEntry] = {}
        cards = container.select(".mbprofile")
        if len(cards) > 500:
            raise DirectoryStructureError("directory_page_item_limit")
        url_gender: Literal["female", "male", "trans"] | None = None
        if "/female/" in url:
            url_gender = "female"
        elif "/male/" in url:
            url_gender = "male"
        elif "/shemale/" in url:
            url_gender = "trans"

        for card in cards:
            source = None
            for anchor in card.select("a[href]"):
                try:
                    source = self.normalize_url(urljoin(url, anchor["href"]), kind="profile")
                    break
                except ValueError:
                    continue
            if source is None:
                warnings.append("card_without_supported_profile_url")
                continue
            title = card.select_one(".mbtit")
            name = title.get_text(" ", strip=True) or None if title else None
            rank_node = card.select_one(".mbrank")
            rank_match = re.match(r"^\s*([0-9][0-9, ]*)", rank_node.get_text(" ", strip=True)) if rank_node else None
            rank_digits = re.sub(r"[ ,]", "", rank_match[1]) if rank_match else ""
            rank = int(rank_digits) if rank_digits and len(rank_digits) <= 18 else None
            key = stable_key(self.adapter_id, source)
            entry = ProfileEntry(
                key=key, source_url=source, name=name, image_url=self._image(url, card),
                rank=rank if rank and rank > 0 else None,
                video_count=self._count(card, "Videos"), photo_count=self._count(card, "Photos"),
                provenance_page_url=url,
                gender=url_gender,
            )
            if key in profiles:
                warnings.append("duplicate_profile_card")
                # Merge only missing facts, never replace a known value by null.
                previous = profiles[key].model_dump()
                profiles[key] = ProfileEntry(**{k: v if v is not None else entry.model_dump()[k] for k, v in previous.items()})
            else:
                profiles[key] = entry
        if cards and not profiles:
            raise DirectoryStructureError("directory_cards_not_recognized")

        current = self.page_number(url)
        page_links = {}
        navs = soup.select(".numlist, .numlist2")
        for anchor in soup.select('.numlist a[href], .numlist2 a[href], a[rel="next"][href], a[rel="prev"][href]'):
            target = self._linked_directory(url, anchor["href"], same_context=True)
            if target is not None and target != url:
                page_links[target] = PageLink(url=target, page=self.page_number(target))
        links = sorted(page_links.values(), key=lambda link: link.page)
        following = [link for link in links if link.page > current]
        previous = [link for link in links if link.page < current]
        # Only an explicit pagination region establishes a known end.
        has_more = bool(following) if navs or links else None
        current_parts = urlsplit(url)
        current_match = self.directory_path.fullmatch(current_parts.path)
        all_path = "/pornstar-list/" + ((current_match["category"] + "/") if current_match["category"] else "")
        capabilities = DirectoryCapabilities(
            all_url=urlunsplit((current_parts.scheme, current_parts.netloc, all_path, current_parts.query, "")),
            query_url=self.context_url(url), active_letter=current_match["letter"], active_category=current_match["category"],
        )
        for anchor in soup.select("a[href]"):
            target = self._linked_directory(url, anchor["href"], same_context=False)
            if target is None:
                continue
            match = self.directory_path.fullmatch(urlsplit(target).path)
            if match["page"]:
                continue
            # Source-provided navigation chooses the route. Keep existing query
            # filters when the source link omits them; never guess routes in UI.
            target_parts = urlsplit(target)
            inherited = parse_qsl(current_parts.query, keep_blank_values=True)
            explicit = parse_qsl(target_parts.query, keep_blank_values=True)
            explicit_keys = {key for key, _ in explicit}
            query = urlencode(sorted(set([(key, value) for key, value in inherited if key not in explicit_keys] + explicit)))
            target = urlunsplit((target_parts.scheme, target_parts.netloc, target_parts.path, query, ""))
            if match["letter"]:
                capabilities.alphabet_links[match["letter"]] = target
            elif match["category"]:
                capabilities.category_links[match["category"]] = target
        for form in soup.select("form"):
            action = self._linked_directory(url, form.get("action") or url, same_context=False)
            if action is None or form.get("method", "get").lower() != "get":
                continue
            for field in form.select("select[name], input[type=range][name], input[type=number][name]"):
                name = field["name"]
                if name in self.choice_filters and field.name == "select":
                    choices = [FilterChoice(value=o.get("value", ""), label=o.get_text(" ", strip=True))
                               for o in field.select("option[value]")
                               if re.fullmatch(r"[A-Za-z0-9 _-]{0,64}", o.get("value", "")) and not o.has_attr("disabled")]
                    capabilities.remote_filters.append(SourceFilter(name=name, kind="choice", multiple=field.has_attr("multiple") or name.endswith("[]"), choices=choices))
                elif name in self.number_filters:
                    minimum = int(field["min"]) if re.fullmatch(r"[0-9]{1,4}", field.get("min", "")) else None
                    maximum = int(field["max"]) if re.fullmatch(r"[0-9]{1,4}", field.get("max", "")) else None
                    capabilities.remote_filters.append(SourceFilter(name=name, kind="number", minimum=minimum, maximum=maximum))
        entries = list(profiles.values())
        for field in ("rank", "video_count", "photo_count"):
            if any(getattr(entry, field) is not None for entry in entries):
                capabilities.local_sort_fields.append(field)
        ranks = [entry.rank for entry in entries]
        if ranks and all(rank is not None for rank in ranks) and ranks == sorted(ranks):
            capabilities.source_order = "rank"
        page_complete = "card_without_supported_profile_url" not in warnings
        return DirectoryPage(
            adapter_id=self.adapter_id,
            directory_key=stable_key(self.adapter_id, "https://www.eporner.com/pornstar-list/"),
            query_key=stable_key(self.adapter_id, self.context_url(url)),
            source_url="https://www.eporner.com/pornstar-list/", page_url=url,
            items=entries, loaded_count=len(entries), page_complete=page_complete,
            directory_complete=page_complete and current == 1 and has_more is False,
            pagination=DirectoryPagination(current_page=current, links=links,
                previous_url=previous[-1].url if previous else None,
                next_url=following[0].url if following else None, has_more=has_more),
            capabilities=capabilities, warnings=sorted(set(warnings)),
        )


class PornhubDirectoryAdapter:
    adapter_id = "pornhub"
    profile_path = re.compile(
        r"^/(?:pornstar|model|channels|users)/[a-zA-Z0-9_\-]+(?:/(?:videos|photos|playlists|gifs|about|stream))?/?\Z",
        re.I,
    )
    directory_path = re.compile(
        r"^/(?:pornstars|channels|categories)(?:/[a-zA-Z0-9_\-]+)?/?\Z",
        re.I,
    )

    def normalize_url(self, url: str, *, kind: str = "directory") -> str:
        if not isinstance(url, str) or len(url) > 4096 or any(ord(c) < 33 for c in url):
            raise DirectoryInputError("invalid_url")
        try:
            parts = urlsplit(url)
            host = (parts.hostname or "").lower()
            valid_host = bool(re.search(r"(?:^|\.)pornhub\.[a-z.]+$", host))
            valid_origin = (
                parts.scheme in ("http", "https")
                and valid_host
                and parts.port in (None, 80, 443)
                and not parts.username
                and not parts.password
                and not parts.fragment
                and "\\" not in url
            )
        except ValueError as exc:
            raise DirectoryInputError("invalid_url") from exc
        if not valid_origin:
            raise DirectoryInputError("unsupported_origin")

        raw_path = "/" + parts.path.strip("/") if parts.path.strip("/") else "/pornstars"
        if kind == "profile":
            if not self.profile_path.match(raw_path):
                raise DirectoryInputError("unsupported_route")
            from .profile_hub_workers import normalize_pornhub_profile_base_url
            return normalize_pornhub_profile_base_url(url)

        if kind == "directory":
            if not self.directory_path.match(raw_path):
                raise DirectoryInputError("unsupported_route")
        else:
            raise DirectoryInputError("unsupported_kind")

        try:
            pairs = parse_qsl(parts.query, keep_blank_values=True, max_num_fields=48, errors="strict")
        except (ValueError, UnicodeError) as exc:
            raise DirectoryInputError("invalid_filters") from exc

        seen = set()
        normalized_pairs = []
        for key, value in pairs:
            if not re.fullmatch(r"[A-Za-z0-9_\-\[\]]{1,64}", key):
                raise DirectoryInputError("unsupported_filter")
            if not re.fullmatch(r"[A-Za-z0-9 _\-\+\.]{0,128}", value):
                raise DirectoryInputError("invalid_filter_value")
            if key == "page":
                if not value.isdigit() or int(value) < 1 or int(value) > 100000:
                    raise DirectoryInputError("invalid_page")
                if value == "1":
                    continue
            if key in seen and not key.endswith("[]"):
                raise DirectoryInputError("duplicate_filter")
            seen.add(key)
            normalized_pairs.append((key, value))

        query = urlencode(sorted(set(normalized_pairs)))
        return urlunsplit(("https", "www.pornhub.com", raw_path, query, ""))

    def recognize(self, url: str) -> Literal["directory", "profile"] | None:
        for kind in ("directory", "profile"):
            try:
                self.normalize_url(url, kind=kind)
                return kind
            except DirectoryInputError:
                continue
        return None

    def context_url(self, url: str) -> str:
        normalized = self.normalize_url(url)
        parts = urlsplit(normalized)
        pairs = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k != "page"]
        query = urlencode(sorted(set(pairs)))
        return urlunsplit((parts.scheme, parts.netloc, parts.path, query, ""))

    def page_number(self, url: str) -> int:
        parts = urlsplit(url)
        for k, v in parse_qsl(parts.query, keep_blank_values=True):
            if k == "page" and v.isdigit():
                val = int(v)
                if 1 <= val <= 100000:
                    return val
        return 1

    def _linked_directory(self, base: str, href: str, *, same_context: bool) -> str | None:
        try:
            target = _merge_context_query(base, href) if same_context else urljoin(base, href)
            url = self.normalize_url(target)
        except (ValueError, DirectoryInputError):
            return None
        if same_context and self.context_url(url) != self.context_url(base):
            return None
        return url

    @staticmethod
    def _image(base: str, card) -> str | None:
        img = card.css_first("img")
        if img is None:
            return None
        for attr in ("data-image", "data-thumb_url", "data-src", "data-original", "src"):
            raw = (img.attributes.get(attr) or "").strip()
            if not raw or raw.startswith("data:") or any(x in raw.lower() for x in ("blank.gif", "placeholder", "transparent.gif")):
                continue
            try:
                candidate = urljoin(base, raw)
                parts = urlsplit(candidate)
                hostname = (parts.hostname or "").lower()
                safe_host = (
                    hostname in ("pornhub.com", "phncdn.com")
                    or hostname.endswith(".pornhub.com")
                    or hostname.endswith(".phncdn.com")
                )
                safe = (
                    parts.scheme == "https"
                    and safe_host
                    and parts.port in (None, 443)
                    and not parts.username
                    and not parts.password
                )
            except ValueError:
                safe = False
            if safe:
                return urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ""))
        return None

    def parse(self, url: str, html: str) -> DirectoryPage:
        from selectolax.lexbor import LexborHTMLParser
        url = self.normalize_url(url)
        tree = LexborHTMLParser(html)

        cards = tree.css(
            "li.performerCard, li.channelCard, ul#popularPornstars li, ul#pornstarDirectory li, li.pornstarListItem"
        )
        has_directory_markers = bool(
            cards
            or tree.css(
                ".paginationHolder, .firstPage, .filterWrapper, #pornstarsFilterSection, .subNav, .subFilter, .performerCard"
            )
        )
        if not has_directory_markers:
            raise DirectoryStructureError("directory_structure_not_found")
        if len(cards) > 500:
            raise DirectoryStructureError("directory_page_item_limit")

        warnings: list[str] = []
        profiles: dict[str, ProfileEntry] = {}

        current_parts = urlsplit(url)
        query_dict = dict(parse_qsl(current_parts.query))
        g_param = query_dict.get("gender", "").lower()
        url_gender: Literal["female", "male", "trans"] | None = None
        if g_param == "female":
            url_gender = "female"
        elif g_param == "male":
            url_gender = "male"
        elif g_param in ("m2f", "f2m", "transgender"):
            url_gender = "trans"

        for card in cards:
            anchor = card.css_first(
                "a.performerName, a[href*='/pornstar/'], a[href*='/model/'], a[href*='/channels/'], a[href*='/users/']"
            )
            if anchor is None:
                anchor = card.css_first("a[href]")

            source = None
            if anchor is not None:
                href = anchor.attributes.get("href") or ""
                try:
                    source = self.normalize_url(urljoin(url, href), kind="profile")
                except ValueError:
                    source = None

            if source is None:
                warnings.append("card_without_supported_profile_url")
                continue

            name = None
            name_el = card.css_first("a.performerName, span.performerCardName, .pornstarName, .title")
            if name_el:
                name = name_el.text(strip=True) or None
            if not name:
                img = card.css_first("img")
                if img:
                    name = (img.attributes.get("alt") or "").strip() or None
            if not name and anchor:
                name = anchor.text(strip=True) or None

            rank = None
            rank_el = card.css_first("span.rankNumber, .rankNumber, .rankinfo")
            if rank_el:
                m = re.search(r"\b([0-9]+)\b", rank_el.text(strip=True))
                if m and len(m.group(1)) <= 18:
                    val = int(m.group(1))
                    if val > 0:
                        rank = val

            video_count = None
            v_el = card.css_first(".videosCount, .videos_count")
            if v_el:
                m = re.search(r"([0-9]+(?:[ ,][0-9]{3})*)", v_el.text(strip=True))
                if m:
                    digits = re.sub(r"[ ,]", "", m.group(1))
                    if len(digits) <= 18:
                        video_count = int(digits)

            desc_parts = []
            verified_el = card.css_first(".verified-icon, [data-title*='Verified']")
            if verified_el:
                desc_parts.append("Verified")
            views_el = card.css_first(".viewsCount, .views_count")
            if views_el:
                views_text = views_el.text(strip=True)
                if views_text:
                    desc_parts.append(views_text)
            description = " • ".join(desc_parts) if desc_parts else None

            key = stable_key(self.adapter_id, source)
            entry = ProfileEntry(
                key=key,
                source_url=source,
                name=name,
                image_url=self._image(url, card),
                description=description,
                rank=rank,
                video_count=video_count,
                provenance_page_url=url,
                gender=url_gender,
            )
            if key in profiles:
                warnings.append("duplicate_profile_card")
                previous = profiles[key].model_dump()
                profiles[key] = ProfileEntry(
                    **{k: v if v is not None else entry.model_dump()[k] for k, v in previous.items()}
                )
            else:
                profiles[key] = entry

        if cards and not profiles:
            raise DirectoryStructureError("directory_cards_not_recognized")

        current = self.page_number(url)
        page_links: dict[str, PageLink] = {}
        for anchor in tree.css(
            ".paginationHolder a[href], ul.firstPage a[href], li.page_number a[href], li.page_next a[href], li.page_previous a[href], a.orangeButton[href], a.greyButton[href]"
        ):
            href = anchor.attributes.get("href") or ""
            if not href or href == "#":
                continue
            target = self._linked_directory(url, href, same_context=True)
            if target is not None and target != url:
                p_num = self.page_number(target)
                page_links[target] = PageLink(url=target, page=p_num)

        links = sorted(page_links.values(), key=lambda link: link.page)
        following = [link for link in links if link.page > current]
        previous = [link for link in links if link.page < current]

        next_url = None
        prev_url = None
        page_next_li = tree.css_first("li.page_next")
        if page_next_li and "disabled" not in (page_next_li.attributes.get("class") or ""):
            a_next = page_next_li.css_first("a[href]")
            if a_next:
                next_url = self._linked_directory(url, a_next.attributes.get("href") or "", same_context=True)

        page_prev_li = tree.css_first("li.page_previous")
        if page_prev_li and "disabled" not in (page_prev_li.attributes.get("class") or ""):
            a_prev = page_prev_li.css_first("a[href]")
            if a_prev:
                prev_url = self._linked_directory(url, a_prev.attributes.get("href") or "", same_context=True)

        if not next_url and following:
            next_url = following[0].url
        if not prev_url and previous:
            prev_url = previous[-1].url

        has_more = bool(following or next_url) if (tree.css(".paginationHolder, ul.firstPage, li.page_current") or links) else None

        current_parts = urlsplit(url)
        query_dict = dict(parse_qsl(current_parts.query))
        active_letter = query_dict.get("letter", "").upper() or None
        base_source = urlunsplit(("https", "www.pornhub.com", current_parts.path, "", ""))
        alphabet_links = {
            ch: urlunsplit((
                "https",
                "www.pornhub.com",
                "/pornstars",
                urlencode([(k, v) for k, v in parse_qsl(current_parts.query) if k not in ("page", "letter")] + [("letter", ch.lower())]),
                "",
            ))
            for ch in "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        }
        category_links = {}
        for a in tree.css("a[href*='gender=']"):
            href = a.attributes.get("href") or ""
            norm_href = self._linked_directory(url, href, same_context=False)
            if not norm_href:
                continue
            m_gen = re.search(r"gender=([a-z0-9_\-]+)", norm_href, re.I)
            if m_gen:
                category_links[m_gen.group(1).lower()] = norm_href

        capabilities = DirectoryCapabilities(
            all_url=base_source,
            query_url=self.context_url(url),
            active_letter=active_letter,
            alphabet_links=alphabet_links,
            category_links=category_links,
        )

        capabilities.remote_filters = [
            SourceFilter(
                name="gender",
                kind="choice",
                multiple=False,
                choices=[
                    FilterChoice(value="", label="All"),
                    FilterChoice(value="female", label="Female"),
                    FilterChoice(value="male", label="Male"),
                    FilterChoice(value="m2f", label="Trans Woman"),
                    FilterChoice(value="f2m", label="Trans Man"),
                ],
            ),
            SourceFilter(
                name="ethnicity",
                kind="choice",
                multiple=False,
                choices=[
                    FilterChoice(value="", label="All"),
                    FilterChoice(value="asian", label="Asian"),
                    FilterChoice(value="black", label="Black"),
                    FilterChoice(value="indian", label="Indian"),
                    FilterChoice(value="latin", label="Latin"),
                    FilterChoice(value="middle+eastern", label="Middle Eastern"),
                    FilterChoice(value="mixed", label="Mixed"),
                    FilterChoice(value="white", label="White"),
                    FilterChoice(value="other", label="Other"),
                ],
            ),
            SourceFilter(
                name="hair",
                kind="choice",
                multiple=False,
                choices=[
                    FilterChoice(value="", label="All"),
                    FilterChoice(value="auburn", label="Auburn"),
                    FilterChoice(value="bald", label="Bald"),
                    FilterChoice(value="black", label="Black"),
                    FilterChoice(value="blonde", label="Blonde"),
                    FilterChoice(value="brunette", label="Brunette"),
                    FilterChoice(value="grey", label="Grey"),
                    FilterChoice(value="red", label="Red"),
                    FilterChoice(value="various", label="Various"),
                    FilterChoice(value="other", label="Other"),
                ],
            ),
            SourceFilter(
                name="cup",
                kind="choice",
                multiple=False,
                choices=[
                    FilterChoice(value="", label="All"),
                    FilterChoice(value="a", label="A"),
                    FilterChoice(value="b", label="B"),
                    FilterChoice(value="c", label="C"),
                    FilterChoice(value="d", label="D"),
                    FilterChoice(value="e", label="E"),
                    FilterChoice(value="f-z", label="F-Z"),
                ],
            ),
            SourceFilter(
                name="tattoos",
                kind="choice",
                multiple=False,
                choices=[
                    FilterChoice(value="", label="All"),
                    FilterChoice(value="yes", label="Yes"),
                    FilterChoice(value="no", label="No"),
                ],
            ),
            SourceFilter(
                name="piercings",
                kind="choice",
                multiple=False,
                choices=[
                    FilterChoice(value="", label="All"),
                    FilterChoice(value="yes", label="Yes"),
                    FilterChoice(value="no", label="No"),
                ],
            ),
            SourceFilter(
                name="breasttype",
                kind="choice",
                multiple=False,
                choices=[
                    FilterChoice(value="", label="All"),
                    FilterChoice(value="natural", label="Natural"),
                    FilterChoice(value="fake", label="Fake"),
                ],
            ),
        ]

        entries = list(profiles.values())
        capabilities.local_sort_fields = ["name"]
        for field in ("rank", "video_count", "photo_count"):
            if any(getattr(entry, field) is not None for entry in entries):
                capabilities.local_sort_fields.append(field)
        ranks = [entry.rank for entry in entries if entry.rank is not None]
        if ranks and ranks == sorted(ranks):
            capabilities.source_order = "rank"

        page_complete = "card_without_supported_profile_url" not in warnings
        return DirectoryPage(
            adapter_id=self.adapter_id,
            directory_key=stable_key(self.adapter_id, base_source),
            query_key=stable_key(self.adapter_id, self.context_url(url)),
            source_url=base_source,
            page_url=url,
            items=entries,
            loaded_count=len(entries),
            page_complete=page_complete,
            directory_complete=page_complete and current == 1 and has_more is False,
            pagination=DirectoryPagination(
                current_page=current,
                links=links,
                previous_url=prev_url,
                next_url=next_url,
                has_more=has_more,
                reported_total=max([link.page for link in links], default=current),
            ),
            capabilities=capabilities,
            warnings=sorted(set(warnings)),
        )


def _parse_xh_metric_count(txt: str) -> int | None:
    if not txt:
        return None
    clean = txt.strip().upper()
    m = re.match(r"^([\d.,]+)\s*([KMB])?$", clean)
    if not m:
        digits = re.sub(r"[^\d]", "", clean)
        return int(digits) if digits and len(digits) <= 18 else None
    num_str, mult = m.group(1), m.group(2)
    try:
        val = float(num_str.replace(",", ""))
        if mult == "K":
            val *= 1_000
        elif mult == "M":
            val *= 1_000_000
        elif mult == "B":
            val *= 1_000_000_000
        return int(val)
    except Exception:
        return None


KNOWN_MALE_PERFORMERS = frozenset({
    "johnny-sins", "johnny sins",
    "danny-d", "danny d",
    "tim-deen", "tim deen",
    "jordi-el-nino-polla", "jordi el nino polla", "jordi",
    "alex-adams", "alex adams",
    "rocco-siffredi", "rocco siffredi",
    "mick-blue", "mick blue",
    "manuel-ferrara", "manuel ferrara",
    "keiran-lee", "keiran lee", "kieran-lee", "kieran lee",
    "markus-dupree", "markus dupree",
    "tommy-gunn", "tommy gunn",
    "nacho-vidal", "nacho vidal",
    "christian-clay", "christian clay",
    "seth-gamble", "seth gamble",
    "charles-dera", "charles dera",
    "evan-stone", "evan stone",
    "james-deen", "james deen",
    "ramon-nomar", "ramon nomar",
    "logan-long", "logan long",
    "scott-nails", "scott nails",
    "peter-green", "peter green",
    "bill-bailey", "bill bailey",
    "tony-rubino", "tony rubino",
    "ricky-johnson", "ricky johnson",
    "dread-full", "dread full",
    "isiah-maxwell", "isiah maxwell",
    "rob-piper", "rob piper",
    "jean-val-jean", "jean val jean",
    "rick-adams", "rick adams",
    "vince-karter", "vince karter",
    "lucas-frost", "lucas frost",
    "mark-wood", "mark wood",
    "trent-tesoro", "trent tesoro",
    "adam-russo", "adam russo",
    "alex-legend", "alex legend",
    "mr-pete", "mr pete", "mr. pete",
    "erik-everhard", "erik everhard",
    "steve-holmes", "steve holmes",
    "john-strong", "john strong",
    "michael-stefano", "michael stefano",
    "barry-scott", "barry scott",
    "jack-hammer", "jack hammer",
    "jules-jordan", "jules jordan",
    "guy-di-silva", "guy di silva",
    "marco-banderas", "marco banderas",
    "chris-strokes", "chris strokes",
    "bruce-venture", "bruce venture",
    "damon-dice", "damon dice",
    "danny-mountain", "danny mountain",
    "sterling-knight", "sterling knight",
    "quinton-james", "quinton james",
    "codey-steele", "codey steele",
    "jax-slayer", "jax slayer",
    "oliver-davis", "oliver davis",
    "zac-wild", "zac wild",
    "tony-t", "tony t",
    "pierce-paris", "pierce paris",
    "ryan-mclane", "ryan mclane",
    "derrick-pierce", "derrick pierce",
    "sean-lawless", "sean lawless",
    "chad-white", "chad white",
    "trenton-ducati", "trenton ducati",
    "will-pounder", "will pounder",
})


def is_male_performer(name: str | None, url: str | None) -> bool:
    if name:
        clean_name = re.sub(r"[^a-z0-9 ]+", " ", name.lower()).strip()
        if clean_name in KNOWN_MALE_PERFORMERS:
            return True
        clean_slug = clean_name.replace(" ", "-")
        if clean_slug in KNOWN_MALE_PERFORMERS:
            return True
    if url:
        try:
            slug = (urlsplit(url).path.split("/")[-1] or "").lower()
            clean_slug = re.sub(r"[^a-z0-9]+", "-", slug).strip("-")
            if clean_slug in KNOWN_MALE_PERFORMERS or clean_slug.replace("-", " ") in KNOWN_MALE_PERFORMERS:
                return True
        except Exception:
            pass
    return False


class XhamsterDirectoryAdapter:
    adapter_id = "xhamster"
    hosts = frozenset({"xhamster.com", "xhcdn.com", "xhday.com", "xhvideotop.com", "xhamsterlive.com"})
    reserved_prefixes = frozenset({"all", "top", "categories", "countries", "vr", "4k", "best", "pornstars"})

    def normalize_url(self, url: str, *, kind: str = "directory") -> str:
        if not isinstance(url, str) or len(url) > 4096 or any(ord(c) < 33 for c in url):
            raise DirectoryInputError("invalid_url")
        try:
            parts = urlsplit(url.strip())
            host = (parts.hostname or "").lower()
            valid_host = bool(
                re.search(
                    r"(?:^|\.)(?:[a-z]{2,3}\.)?(xhamster|xhcdn|xhday|xhvideotop|xhamsterlive|xhamster\d*)\.[a-z.]+$",
                    host,
                )
            )
            valid_origin = (
                parts.scheme in ("http", "https")
                and valid_host
                and parts.port in (None, 80, 443)
                and not parts.username
                and not parts.password
                and not parts.fragment
                and "\\" not in url
            )
        except ValueError as exc:
            raise DirectoryInputError("invalid_url") from exc
        if not valid_origin:
            raise DirectoryInputError("unsupported_origin")

        raw_path = "/" + parts.path.strip("/") if parts.path.strip("/") else "/pornstars"
        path_segments = [p.lower() for p in raw_path.split("/") if p]

        first = path_segments[0] if path_segments else "pornstars"
        is_orientation = first in ("gay", "shemale")
        if not is_orientation and first not in ("pornstars", "channels", "creators", "users", "models", "celebrities"):
            raise DirectoryInputError("unsupported_route")

        is_dir = False
        if is_orientation:
            if len(path_segments) == 2 and path_segments[1] in ("pornstars", "creators"):
                is_dir = True
            elif len(path_segments) > 2 and path_segments[1] in ("pornstars", "creators"):
                third = path_segments[2]
                if third.isdigit() or third in self.reserved_prefixes:
                    is_dir = True
        elif len(path_segments) == 1:
            is_dir = True
        elif first in ("pornstars", "creators", "celebrities"):
            second = path_segments[1]
            if second.isdigit() or second in self.reserved_prefixes:
                is_dir = True

        if kind == "profile":
            if is_dir:
                raise DirectoryInputError("unsupported_route")
            from .profile_hub_workers import normalize_xhamster_profile_base_url
            return normalize_xhamster_profile_base_url(url)

        if kind == "directory":
            if not is_dir:
                raise DirectoryInputError("unsupported_route")
        else:
            raise DirectoryInputError("unsupported_kind")

        clean_path = raw_path
        if clean_path.endswith("/1"):
            clean_path = clean_path[:-2]
            if not clean_path:
                clean_path = "/pornstars"

        try:
            pairs = parse_qsl(parts.query, keep_blank_values=True, max_num_fields=48, errors="strict")
        except (ValueError, UnicodeError) as exc:
            raise DirectoryInputError("invalid_filters") from exc

        seen = set()
        normalized_pairs = []
        for key, value in pairs:
            if not re.fullmatch(r"[A-Za-z0-9_\-\[\]]{1,64}", key):
                raise DirectoryInputError("unsupported_filter")
            if not re.fullmatch(r"[A-Za-z0-9 _\-\+\.]{0,128}", value):
                raise DirectoryInputError("invalid_filter_value")
            if key == "page":
                if not value.isdigit() or int(value) < 1 or int(value) > 100000:
                    raise DirectoryInputError("invalid_page")
                if value == "1":
                    continue
            if key in seen and not key.endswith("[]"):
                raise DirectoryInputError("duplicate_filter")
            seen.add(key)
            normalized_pairs.append((key, value))

        query = urlencode(sorted(set(normalized_pairs)))
        return urlunsplit(("https", "xhamster.com", clean_path, query, ""))

    def recognize(self, url: str) -> Literal["directory", "profile"] | None:
        for kind in ("directory", "profile"):
            try:
                self.normalize_url(url, kind=kind)
                return kind
            except DirectoryInputError:
                continue
        return None

    def context_url(self, url: str) -> str:
        normalized = self.normalize_url(url)
        parts = urlsplit(normalized)
        path = re.sub(r"/\d+$", "", parts.path)
        if not path:
            path = "/pornstars"
        pairs = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k != "page"]
        query = urlencode(sorted(set(pairs)))
        return urlunsplit((parts.scheme, parts.netloc, path, query, ""))

    def page_number(self, url: str) -> int:
        parts = urlsplit(url)
        m = re.search(r"/(\d+)/?$", parts.path)
        if m:
            try:
                p = int(m.group(1))
                if 1 <= p <= 100000:
                    return p
            except ValueError:
                pass
        for k, v in parse_qsl(parts.query, keep_blank_values=True):
            if k == "page" and v.isdigit():
                val = int(v)
                if 1 <= val <= 100000:
                    return val
        return 1

    def _linked_directory(self, base: str, href: str, *, same_context: bool) -> str | None:
        try:
            target = _merge_context_query(base, href) if same_context else urljoin(base, href)
            url = self.normalize_url(target)
        except (ValueError, DirectoryInputError):
            return None
        if same_context and self.context_url(url) != self.context_url(base):
            return None
        return url

    @staticmethod
    def _image(base: str, card) -> str | None:
        img = card.css_first("img")
        if img is None:
            return None
        for attr in ("data-src", "data-original", "data-thumb", "src"):
            raw = (img.attributes.get(attr) or "").strip()
            if not raw or raw.startswith("data:") or any(x in raw.lower() for x in ("blank.gif", "placeholder", "transparent.gif")):
                continue
            try:
                candidate = urljoin(base, raw)
                parts = urlsplit(candidate)
                hostname = (parts.hostname or "").lower()
                safe_host = (
                    "xhcdn" in hostname
                    or "xhamster" in hostname
                    or hostname.endswith(".xhcdn.com")
                    or hostname.endswith(".xhamster.com")
                )
                safe = (
                    parts.scheme == "https"
                    and safe_host
                    and parts.port in (None, 443)
                    and not parts.username
                    and not parts.password
                )
            except ValueError:
                safe = False
            if safe:
                return urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ""))
        return None

    def parse(self, url: str, html: str) -> DirectoryPage:
        from selectolax.lexbor import LexborHTMLParser
        url = self.normalize_url(url)
        tree = LexborHTMLParser(html)

        # Target genuine performer cards (div[data-name] or desktop cards containing performer avatar/link)
        cards = tree.css("div[data-name]")
        if not cards:
            seen_ids = set()
            found = []
            for link in tree.css("a[data-role='pornstar-link']"):
                parent = link.parent
                while parent and parent.tag != "body":
                    cls = parent.attributes.get("class") or ""
                    if "root-" in cls and "desktop-" in cls and not any(x in cls for x in ("letters-", "alphabet-", "width-wrap", "footer")):
                        if id(parent) not in seen_ids and parent.css_first("img"):
                            seen_ids.add(id(parent))
                            found.append(parent)
                        break
                    parent = parent.parent
            cards = found

        if not cards:
            # Fallback for alphabet letter index pages (/pornstars/all/{letter})
            alpha_cards = tree.css("div.oneLetterList a[href*='/pornstars/'], div[class*='oneLetterList'] a[href*='/pornstars/']")
            cards = [c for c in alpha_cards if not re.search(r"/pornstars/all/[a-z]$", c.attributes.get("href") or "", re.I)]

        has_directory_markers = bool(
            cards
            or tree.css("nav.desktop-pagination, div[class*='pagination'], a[data-role='pornstar-link'], a[href*='/pornstars/all/'], div.oneLetterList")
        )
        if not has_directory_markers:
            raise DirectoryStructureError("directory_structure_not_found")
        if len(cards) > 10000:
            raise DirectoryStructureError("directory_page_item_limit")

        warnings: list[str] = []
        profiles: dict[str, ProfileEntry] = {}

        current_parts = urlsplit(url)
        query_dict = dict(parse_qsl(current_parts.query))
        g_param = query_dict.get("gender", "").lower()
        url_gender: Literal["female", "male", "trans"] | None = None
        if g_param == "female":
            url_gender = "female"
        elif g_param == "male":
            url_gender = "male"
        elif g_param in ("m2f", "f2m", "transgender"):
            url_gender = "trans"

        for card in cards:
            if card.tag == "a":
                anchor = card
            else:
                anchor = card.css_first("a[data-role='pornstar-link'], a[href*='/pornstars/']")
            if anchor is None:
                continue
            raw_href = anchor.attributes.get("href") or ""
            try:
                source = self.normalize_url(urljoin(url, raw_href), kind="profile")
            except ValueError:
                continue

            name = (
                card.attributes.get("data-name")
                or (card.css_first("[class*='infoTitle'] a, a[class*='name'], [class*='name-']") or anchor).text(strip=True)
                or None
            )

            rank_el = card.css_first("[class*='rating-'], [class*='rank-'], [class*='rank']")
            rank = None
            if rank_el:
                m_rank = re.search(r"#?(\d+)", rank_el.text(strip=True))
                if m_rank:
                    try:
                        rank = int(m_rank.group(1))
                    except ValueError:
                        pass

            video_cnt = None
            photo_cnt = None
            for metric in card.css("[class*='metric-']"):
                m_txt = metric.text(strip=True)
                use_tag = metric.css_first("use")
                icon_id = (use_tag.attributes.get("xlink:href") or use_tag.attributes.get("href") or "") if use_tag else ""
                cnt = _parse_xh_metric_count(m_txt)
                if "#video" in icon_id:
                    video_cnt = cnt
                elif "#photo" in icon_id or "#moments" in icon_id:
                    photo_cnt = cnt

            views_el = card.css_first("[class*='views-'], [class*='views']")
            desc = views_el.text(strip=True) if views_el else None
            flag_el = card.css_first("a[class*='flagLink-'], [data-country]")
            if flag_el and flag_el.attributes.get("data-tooltip"):
                country = flag_el.attributes.get("data-tooltip")
                desc = f"{desc} • {country}" if desc else country

            img_url = self._image(url, card)
            key = stable_key(self.adapter_id, source)

            slug = (urlsplit(source).path.split("/")[-1] or "").lower()
            norm_name = (name or "").lower().strip()
            if url.startswith("https://xhamster.com/shemale/") or "/shemale/" in url:
                card_gender = "trans"
            elif url.startswith("https://xhamster.com/gay/") or "/gay/" in url:
                card_gender = "male"
            elif is_male_performer(name, source):
                card_gender = "male"
            else:
                card_gender = "female"

            entry = ProfileEntry(
                key=key,
                source_url=source,
                name=name,
                image_url=img_url,
                description=desc,
                rank=rank if rank and rank > 0 else None,
                video_count=video_cnt,
                photo_count=photo_cnt,
                provenance_page_url=url,
                gender=card_gender,
            )

            if key in profiles:
                warnings.append("duplicate_profile_card")
                prev = profiles[key].model_dump()
                profiles[key] = ProfileEntry(**{k: v if v is not None else entry.model_dump()[k] for k, v in prev.items()})
            else:
                profiles[key] = entry

        query_dict = dict(parse_qsl(urlsplit(url).query))
        filter_gender = query_dict.get("gender", "").lower()
        if filter_gender == "female":
            profiles = {k: v for k, v in profiles.items() if v.gender != "male" and not is_male_performer(v.name, v.source_url)}
        elif filter_gender == "male":
            profiles = {k: v for k, v in profiles.items() if v.gender == "male" or is_male_performer(v.name, v.source_url)}
        elif filter_gender == "trans":
            profiles = {k: v for k, v in profiles.items() if v.gender == "trans"}

        current = self.page_number(url)
        page_links = {}
        for a in tree.css("nav.desktop-pagination a[href], div[class*='pagination'] a[href], a[rel='next'], a[rel='prev']"):
            target = self._linked_directory(url, a.attributes.get("href") or "", same_context=True)
            if target is not None and target != url:
                p_num = self.page_number(target)
                page_links[target] = PageLink(url=target, page=p_num)

        links = sorted(page_links.values(), key=lambda l: l.page)
        max_page = max([l.page for l in links], default=current)
        has_more = max_page > current

        prev_url = None
        next_url = None
        for l in links:
            if l.page == current - 1:
                prev_url = l.url
            elif l.page == current + 1:
                next_url = l.url

        alphabet_links = {}
        category_links = {}

        for a in tree.css("a[href*='/pornstars/']"):
            href = a.attributes.get("href") or ""
            norm_href = self._linked_directory(url, href, same_context=False)
            if not norm_href:
                continue
            m_alpha = re.search(r"/pornstars/all/([a-z])$", norm_href, re.I)
            if m_alpha:
                letter = m_alpha.group(1).upper()
                if letter not in alphabet_links:
                    alphabet_links[letter] = norm_href
            m_cat = re.search(r"/pornstars/all/(categories/[a-z0-9_\-]+)", norm_href, re.I)
            if m_cat:
                cat_slug = m_cat.group(1)
                if cat_slug not in category_links:
                    category_links[cat_slug] = norm_href

        filter_query = urlencode([(k, v) for k, v in parse_qsl(urlsplit(url).query) if k != "page"])
        for ch in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
            base_alpha = alphabet_links.get(ch, f"https://xhamster.com/pornstars/all/{ch.lower()}")
            if filter_query:
                parts = urlsplit(base_alpha)
                q = f"{parts.query}&{filter_query}" if parts.query else filter_query
                alphabet_links[ch] = urlunsplit((parts.scheme, parts.netloc, parts.path, q, ""))
            else:
                alphabet_links[ch] = base_alpha

        current_path = urlsplit(url).path
        m_curr_alpha = re.search(r"/pornstars/all/([a-z])(?:/\d+)?$", current_path, re.I)
        active_letter = m_curr_alpha.group(1).upper() if m_curr_alpha else None

        active_category = None
        if "/pornstars/all/countries/" in current_path:
            m_c = re.search(r"/pornstars/all/countries/([a-z]+)", current_path, re.I)
            if m_c:
                active_category = f"country_{m_c.group(1).lower()}"
        elif "/pornstars/all/4k" in current_path:
            active_category = "format_4k"
        elif "/pornstars/all/vr" in current_path:
            active_category = "format_vr"
        elif "/pornstars/top/" in current_path:
            m_t = re.search(r"/pornstars/top/([a-z]+)", current_path, re.I)
            if m_t:
                active_category = f"top_{m_t.group(1).lower()}"
        elif "/creators" in current_path:
            active_category = "creators"
        elif "/celebrities" in current_path:
            active_category = "celebrities"
        else:
            m_curr_cat = re.search(r"/pornstars/all/(categories/[a-z0-9_\-]+)", current_path, re.I)
            if m_curr_cat:
                active_category = m_curr_cat.group(1)

        capabilities = DirectoryCapabilities(
            all_url="https://xhamster.com/pornstars",
            query_url=self.context_url(url),
            active_letter=active_letter,
            active_category=active_category,
            alphabet_links=alphabet_links,
            category_links=category_links,
            remote_filters=[
                SourceFilter(
                    name="gender",
                    kind="choice",
                    multiple=False,
                    choices=[
                        FilterChoice(value="", label="All Genders"),
                        FilterChoice(value="female", label="Female"),
                        FilterChoice(value="male", label="Male"),
                        FilterChoice(value="trans", label="Trans / Shemale"),
                    ],
                ),
                SourceFilter(
                    name="country",
                    kind="choice",
                    multiple=False,
                    choices=[
                        FilterChoice(value="", label="All Countries"),
                        FilterChoice(value="us", label="United States"),
                        FilterChoice(value="br", label="Brazil"),
                        FilterChoice(value="jp", label="Japan"),
                        FilterChoice(value="gb", label="United Kingdom"),
                        FilterChoice(value="ru", label="Russian Federation"),
                        FilterChoice(value="de", label="Germany"),
                        FilterChoice(value="fr", label="France"),
                        FilterChoice(value="it", label="Italy"),
                        FilterChoice(value="es", label="Spain"),
                        FilterChoice(value="cz", label="Czech Republic"),
                        FilterChoice(value="ca", label="Canada"),
                        FilterChoice(value="co", label="Colombia"),
                        FilterChoice(value="mx", label="Mexico"),
                        FilterChoice(value="au", label="Australia"),
                        FilterChoice(value="hu", label="Hungary"),
                        FilterChoice(value="nl", label="Netherlands"),
                        FilterChoice(value="pl", label="Poland"),
                        FilterChoice(value="ar", label="Argentina"),
                        FilterChoice(value="ve", label="Venezuela"),
                    ],
                ),
                SourceFilter(
                    name="format",
                    kind="choice",
                    multiple=False,
                    choices=[
                        FilterChoice(value="", label="All Formats"),
                        FilterChoice(value="4k", label="4K Ultra HD"),
                        FilterChoice(value="vr", label="VR"),
                    ],
                ),
                SourceFilter(
                    name="section",
                    kind="choice",
                    multiple=False,
                    choices=[
                        FilterChoice(value="", label="All Sections"),
                        FilterChoice(value="pornstars", label="Top Pornstars"),
                        FilterChoice(value="top_br", label="Popular in Brazil"),
                        FilterChoice(value="creators", label="Creators"),
                        FilterChoice(value="celebrities", label="Celebrities"),
                    ],
                ),
            ],
            name_search_scope="loaded_profiles",
            source_order="rank",
            local_sort_fields=["name", "rank", "video_count", "photo_count"],
        )

        entries = list(profiles.values())
        return DirectoryPage(
            adapter_id=self.adapter_id,
            directory_key=stable_key(self.adapter_id, "https://xhamster.com/pornstars"),
            query_key=stable_key(self.adapter_id, self.context_url(url)),
            source_url="https://xhamster.com/pornstars",
            page_url=url,
            items=entries,
            loaded_count=len(entries),
            page_complete=True,
            directory_complete=current == 1 and not has_more,
            pagination=DirectoryPagination(
                current_page=current,
                links=links,
                previous_url=prev_url,
                next_url=next_url,
                has_more=has_more,
                reported_total=max_page,
            ),
            capabilities=capabilities,
            warnings=sorted(set(warnings)),
        )


ADAPTERS: tuple[DirectoryAdapter, ...] = (
    EpornerDirectoryAdapter(),
    PornhubDirectoryAdapter(),
    XhamsterDirectoryAdapter(),
)


def recognize_profile_input(url: str) -> tuple[DirectoryAdapter, str]:
    """Capability recognition only: never fetches an individual profile."""
    for adapter in ADAPTERS:
        kind = adapter.recognize(url)
        if kind:
            return adapter, kind
    raise DirectoryInputError("unsupported_url")
