# Stage 1: Build the Vite React Frontend
FROM node:20-alpine AS builder

WORKDIR /app

# The frontend has its own package files
COPY package*.json ./
# Use npm install
RUN npm install

# Copy source code and build
COPY . .
RUN npm run build

# Stage 2: Serve the application statically with Nginx
FROM nginx:alpine

# Copy custom Nginx configuration to support client-side routing
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy build artifacts to Nginx html folder
COPY --from=builder /app/dist /usr/share/nginx/html

# Disable root execution where possible, nginx handles this well but we start it
# as standard
EXPOSE 80

# Run nginx in foreground
CMD ["nginx", "-g", "daemon off;"]
