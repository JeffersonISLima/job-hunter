FROM mcr.microsoft.com/playwright:v1.40.0-jammy

# TZ + Python for JobSpy (Brazil/Node.js fallback)
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    tzdata \
    python3 \
    python3-pip \
    python3-venv \
  && ln -snf /usr/share/zoneinfo/America/Sao_Paulo /etc/localtime \
  && echo "America/Sao_Paulo" > /etc/timezone \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --include=dev

COPY requirements-jobspy.txt ./
RUN pip3 install --no-cache-dir -r requirements-jobspy.txt

COPY . .

RUN mkdir -p /app/data \
  && chmod +x /app/entrypoint.sh /app/jobspy_fetch.py

ENTRYPOINT ["/app/entrypoint.sh"]
