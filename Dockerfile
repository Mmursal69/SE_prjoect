# Use Python 3.9
FROM python:3.9

# 1. Install system dependencies required for OpenCV
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# 2. Set up the working directory
WORKDIR /code

# 3. Copy requirements and install them
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip
RUN pip install --no-cache-dir -r requirements.txt

# 4. Copy the rest of the application
COPY . .

# 5. Create a writable directory for the database (Hugging Face specific permission fix)
RUN mkdir -p /code/backend/instance && chmod 777 /code/backend/instance

# 6. Expose the port Hugging Face expects (7860)
EXPOSE 7860

# 7. Start the application
# We point to 'backend.main:app' because your main.py is inside the backend folder
CMD ["gunicorn", "--worker-class", "eventlet", "-w", "1", "--bind", "0.0.0.0:7860", "backend.main:app"]
