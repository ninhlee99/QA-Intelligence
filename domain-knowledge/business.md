# Business rules

## Invariants (must never break)

1. <!-- e.g. order total = sum(line) after discounts -->
2.

## Forbidden states

- <!-- e.g. paid order cannot return to cart -->

## Edge cases Expert must consider

- <!-- timezone, duplicate submit, partial failure -->


## From this test request (auto)

ResumeSearches keyword AND/OR search bug retest on companytools http://localhost:3002/resume_searches/new. Bug: or/and operator was treated as keyword causing LIKE %%or%% false positives. Fix: reject or/and from keyword_match. Scope: search_skills and search_certifications screens.


## Update 2026-08-12 (auto)

URL: http://localhost:3002/resume_searches/new
AC: Fill field キーワード with java, fill field OR with sqlite, then submit the search form; expect the search results page to show
AC: Fill field キーワード with java, fill field AND with sqlite, then submit the search form; expect the search results page to show
AC: Fill field OR with or, then submit the search form; the result count must not be inflated by LIKE %%or%% false positives — results should only contain resumes with java or sqlite keywords


## Update 2026-08-12 (auto)

URL: http://localhost:3002/resume_searches/new
AC: Fill キーワード textbox with java, fill OR textbox with sqlite, then click 検索 button; expect page URL to contain resume_searches


## Update 2026-08-12 (auto)

URL: http://localhost:3002/resume_searches/new
AC: Fill キーワード textbox with java, fill OR textbox with sqlite, then click 検索 button; expect page URL to contain resume_searches


## Update 2026-08-12 (auto)

URL: http://localhost:3002/resume_searches/new
AC: Fill キーワード textbox with java, fill OR textbox with sqlite, then click 検索 button; expect page URL to contain resume_searches
