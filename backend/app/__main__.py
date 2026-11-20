"""Run the local backend on the port supplied by the drill harness."""
import os

import uvicorn


if __name__ == "__main__":
    uvicorn.run("app.main:app", host="127.0.0.1", port=int(os.environ.get("PORT", "8000")))
