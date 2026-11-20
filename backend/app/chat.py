"""Code-built status and plain-text replies for the Firedrill chat alias."""


def chat_status(out: dict) -> str:
    results = out.get("results", [])
    if not results:
        return "NO_RESULTS"
    action = out.get("ui_action") or {}
    if action.get("type") == "focus_listing":
        focused = next((r for r in results if r["listing_id"] == action.get("listing_id")), None)
        if focused and focused["tier"] == "blocked":
            return "BLOCKED_STORE"
        return "TAP_TO_CONFIRM"
    if action.get("type") == "show_options":
        return "TAP_TO_CONFIRM"
    return "RESULTS_READY"


def chat_reply(out: dict) -> str:
    lines = [out["explanation"]] if out.get("explanation") else []
    lines.append("Results (scored by code):")
    for result in out.get("results", []):
        line = f"- {result['store']['name']}, ${result['price']:.0f}: {result['tier']}"
        if result["tier"] != "blocked":
            line += f" ({result['score']})"
        if result.get("reasons"):
            line += f": {result['reasons'][0]['text']}"
        lines.append(line)
    if out.get("say"):
        lines.append(out["say"])
    lines.append(f"Status: {chat_status(out)}")
    return "\n".join(lines)
