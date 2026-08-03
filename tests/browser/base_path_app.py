from fastapi import FastAPI

from mobula.main import create_app


BASE_PATH = "/mobula/opaque-job-id"

app = FastAPI()
app.mount(BASE_PATH, create_app())
