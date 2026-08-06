#!/usr/bin/env python3
"""JobSpy search fallback (Indeed/Glassdoor/Google/LinkedIn) — Brazil + Node.js."""

from __future__ import annotations

import argparse
import json
import math
import sys
from typing import Any


def clean(value: Any) -> str:
    if value is None:
        return ""
    try:
        if isinstance(value, float) and math.isnan(value):
            return ""
    except Exception:
        pass
    text = str(value).strip()
    if text.lower() in {"nan", "none", "nat"}:
        return ""
    return text


def row_to_job(row: Any) -> dict[str, str] | None:
    link = clean(row.get("job_url") or row.get("job_url_direct"))
    title = clean(row.get("title"))
    if not link or not title:
        return None

    description = clean(row.get("description"))
    location_parts = [
        clean(row.get("city")),
        clean(row.get("state")),
        clean(row.get("country")),
    ]
    location = ", ".join([p for p in location_parts if p])
    if str(row.get("is_remote")).lower() in {"true", "1"}:
        location = f"Remoto ({location})" if location else "Remoto"

    salary_bits = []
    min_amount = clean(row.get("min_amount"))
    max_amount = clean(row.get("max_amount"))
    currency = clean(row.get("currency")) or "BRL"
    if min_amount or max_amount:
        salary_bits.append(f"{currency} {min_amount or '?'} - {max_amount or '?'}")

    return {
        "title": title,
        "company": clean(row.get("company")) or "Empresa não identificada",
        "link": link,
        "snippet": description[:280],
        "description": description[:3000],
        "location": location,
        "salary": salary_bits[0] if salary_bits else "",
        "site": clean(row.get("site")),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="JobSpy fetch JSON for Job Hunter")
    parser.add_argument(
        "--sites",
        default="indeed,glassdoor,google",
        help="Comma-separated site list. LinkedIn should run last in orchestration.",
    )
    parser.add_argument(
        "--search-term",
        default="Node.js OR NestJS backend pleno",
        help="Primary search term",
    )
    parser.add_argument("--location", default="Brazil")
    parser.add_argument("--results", type=int, default=8)
    parser.add_argument("--google-search-term", default="Node.js NestJS backend jobs Brazil remote")
    args = parser.parse_args()

    sites = [s.strip() for s in args.sites.split(",") if s.strip()]
    if not sites:
        print("[]")
        return 0

    try:
        from jobspy import scrape_jobs
    except ImportError as exc:
        print(f"[jobspy] biblioteca não instalada: {exc}", file=sys.stderr)
        print("[]")
        return 1

    try:
        # Indeed: do not mix hours_old with is_remote (library limitation)
        df = scrape_jobs(
            site_name=sites,
            search_term=args.search_term,
            google_search_term=args.google_search_term,
            location=args.location,
            results_wanted=args.results,
            country_indeed="Brazil",
            is_remote=True,
            linkedin_fetch_description=("linkedin" in sites),
            description_format="markdown",
            verbose=0,
        )
    except Exception as exc:  # noqa: BLE001
        print(f"[jobspy] falha na busca ({','.join(sites)}): {exc}", file=sys.stderr)
        print("[]")
        return 1

    jobs: list[dict[str, str]] = []
    if df is None or getattr(df, "empty", True):
        print("[]")
        return 0

    for _, row in df.iterrows():
        job = row_to_job(row)
        if job:
            jobs.append(job)

    print(json.dumps(jobs, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
