"""What an image model accepts, read from OpenRouter so the engine never hardcodes it, and cached for a day."""

import base64
import json
import mimetypes
import sys
import time
import urllib.request
import workspace

API = "https://openrouter.ai/api/v1"
CAPABILITY_TTL = 24 * 60 * 60


class Capability:
    """What one model endpoint accepts, read from OpenRouter so the engine never hardcodes it."""

    def __init__(self, model):
        self.model = model
        self.parameters = self.load()

    def batches(self, wanted):
        """Split the wanted image count into calls the model accepts, since many take one image per call."""
        per_call = self.parameters.get("n", {}).get("max", 1)
        return [min(per_call, wanted - start) for start in range(0, wanted, per_call)]

    def request_body(self, prompt, references, options):
        body = {"model": self.model, "prompt": prompt}
        dropped = []

        for key, value in options.items():
            if value is None:
                continue
            if self.accepts(key, value):
                body[key] = value
            else:
                dropped.append(f"{key}={value}")

        if references:
            limit = self.parameters.get("input_references", {}).get("max", 0)
            if len(references) > limit:
                sys.exit(f"{self.model} takes at most {limit} references, got {len(references)}")
            body["input_references"] = [
                {"type": "image_url", "image_url": {"url": data_url(path)}} for path in references
            ]

        return body, dropped

    def accepts(self, key, value):
        rule = self.parameters.get(key)
        if rule is None:
            return False
        if rule.get("type") == "enum":
            return value in rule.get("values", [])
        if rule.get("type") == "range":
            return rule.get("min", value) <= value <= rule.get("max", value)
        return True

    def load(self):
        workspace.CACHE.mkdir(parents=True, exist_ok=True)
        cache = workspace.CACHE / (self.model.replace("/", "__") + ".json")
        if cache.exists() and time.time() - cache.stat().st_mtime < CAPABILITY_TTL:
            return json.loads(cache.read_text())

        with urllib.request.urlopen(f"{API}/images/models/{self.model}/endpoints", timeout=30) as response:
            endpoints = json.load(response).get("endpoints", [])
        if not endpoints:
            sys.exit(f"{self.model} has no image endpoint on OpenRouter")

        parameters = endpoints[0].get("supported_parameters", {})
        cache.write_text(json.dumps(parameters, indent=2))
        return parameters


def reference_limit(model):
    """How many references a model takes, or None when it cannot be read."""
    try:
        return Capability(model).parameters.get("input_references", {}).get("max", 0)
    except (SystemExit, OSError, ValueError):
        return None


def data_url(path):
    media_type = mimetypes.guess_type(path.name)[0] or "image/png"
    return f"data:{media_type};base64,{base64.b64encode(path.read_bytes()).decode()}"
