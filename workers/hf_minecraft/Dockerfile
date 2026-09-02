# workers/hf_minecraft/Dockerfile
# AbsoraCloud Hugging Face Space Dockerfile for Managed Pterodactyl Minecraft Cloud

FROM openjdk:21-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    curl \
    git \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install requests gradio

# Create persistent storage mount directory for 8TB Cloud Bucket
RUN mkdir -p /data/minecraft

COPY app.py /app/app.py

EXPOSE 7860 25565

CMD ["python3", "app.py"]
