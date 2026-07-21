import os
import json
import requests

API_KEY = "AQ.Ab8RN6K1PUefOBzgP8-jve92mSY33h20dz6EOQszUFz-Rgxewg"
ENDPOINT = "https://generativelanguage.googleapis.com/v1/models"

if not API_KEY:
    raise SystemExit(
        "Missing API key. Set the GOOGLE_API_KEY environment variable or update the script with your key."
    )

response = requests.get(ENDPOINT, params={"key": API_KEY}, timeout=20)

try:
    response.raise_for_status()
except requests.HTTPError:
    print(f"Error {response.status_code}: {response.text}")
    raise

data = response.json()
models = data.get("models", [])

if not models:
    print("No models found. Response payload:")
    print(json.dumps(data, indent=2))
else:
    for model in models:
        print(f"Model Name: {model.get('name')}")
        print(f"Display Name: {model.get('displayName')}")
        print(f"Supported Methods: {model.get('supportedGenerationMethods')}\n")
