# Backend image: FastAPI app served by uvicorn on port 8000.
# Dependency pins come from pyproject.toml (single source of truth);
# the cu121 torch wheels come from the PyTorch index flagged in the pip RUN,
# so the slim base image is sufficient.
# Run: docker build -t tachion-backend . && docker run -p 8000:8000 tachion-backend
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Install dependencies first so source edits don't invalidate the pip layer.
# PIP_EXTRA_INDEX_URL is used instead of [tool.uv.index] because pip does not
# read uv config; torch==2.5.1+cu121 needs that index (all other pins resolve
# from PyPI). exported so pip (not just python -c) sees it. tomllib is stdlib
# in 3.11, so python is available pre-install.
# Install dependencies first so source edits don't invalidate the dep layer.
# uv (Rust) replaces pip: 10-50x faster installs. tomllib (stdlib in 3.11)
# extracts the pins from pyproject.toml, the single source of truth; the
# cu121 index comes via --extra-index-url (uv doesn't read [tool.uv.index]
# from the pyproject copy).
COPY --from=ghcr.io/astral-sh/uv:0.13.6 /uv /uvx /bin/
COPY pyproject.toml ./
RUN python -c "import tomllib; deps = tomllib.load(open('pyproject.toml','rb'))['project']['dependencies']; open('/tmp/requirements.tmp', 'w').write('\n'.join(deps))" \
    && uv pip install --system --no-cache --index-strategy unsafe-best-match --extra-index-url https://download.pytorch.org/whl/cu121 -r /tmp/requirements.tmp \
    && rm /tmp/requirements.tmp

# Runtime sources only (data/ gets overlaid by a bind-mount volume in compose)
COPY api/ api/
COPY core/ core/
COPY data/ data/
COPY train/ train/
RUN mkdir -p /app/models

# api/predict.py adds the project root to sys.path, so the project itself is
# not installed into site-packages; deps come solely from the RUN above.

EXPOSE 8000
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
