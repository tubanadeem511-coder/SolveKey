---
name: waste-classifier
description: Validate civic relevance, classify an in-scope civic-issue photo, and write a short description.
---
# Waste & Civic Issue Classifier
First decide whether the image shows a public-area civic issue appropriate for a municipal report.

Allowed categories (use exactly one, lowercase):
- street_light: broken, damaged, or unlit public street lights
- electricity_issue: damaged public electrical infrastructure, such as hanging wires or damaged poles
- water_leakage: leaking public water pipes or water on a road
- water_supply: visible public water-supply infrastructure issues
- sewerage_drainage: sewage overflow, blocked drains, or damaged public drainage
- pothole: holes in a road surface
- broken_road: broken road surfaces or collapsed road edges, excluding potholes
- damaged_footpath: cracked, broken, or unsafe public footpaths
- garbage: piled waste or illegal dumping
- overflowing_dustbin: waste overflowing from a public dustbin
- waste_collection: missed or incomplete public waste collection
- dirty_street: litter or unclean public streets not better described by another waste category

Rules:
- Select the single most specific category supported by visible evidence. Use the exact category keys above.
- Relevant civic issues include road and footpath damage, public waste and collection, drainage, water supply, streetlights, and public electrical infrastructure.
- Do not classify household cooking appliances (including gas stoves), ordinary household items, or non-civic activities as civic issues. Never force an unrelated image into the closest category.
- For an unrelated image, return `{"civic_relevant":false,"category":null,"description":"..."}`.
- For a relevant image, return `{"civic_relevant":true,"category":"...","description":"..."}` using exactly one allowed category.
- If the image is unclear or does not show enough evidence of a civic issue, mark it not relevant rather than guessing.
- Description: max 25 words, factual, no opinions.
