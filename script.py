import requests
import os
from dotenv import load_dotenv

load_dotenv()

HF_TOKEN = os.getenv("HF_TOKEN")

headers = {
    "Authorization": f"Bearer {HF_TOKEN}"
}

def get_model_info(model_id):
    url = f"https://huggingface.co/api/models/{model_id}"

    r = requests.get(url, headers=headers)

    if r.status_code != 200:
        print(r.text)
        return

    data = r.json()

    print("\nMODEL:", model_id)
    print("Inference:", data.get("inference"))

    print("Pipeline:", data.get("pipeline_tag"))

for model in [
    "black-forest-labs/FLUX.1-schnell",
    "stabilityai/stable-diffusion-xl-base-1.0",
    "stabilityai/stable-diffusion-3.5-large"
]:
    get_model_info(model)