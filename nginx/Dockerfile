# Use minimal Nginx Alpine base image
FROM nginx:alpine

# Copy Nginx configuration file
COPY default.conf /etc/nginx/conf.d/default.conf

# Expose HTTP port
EXPOSE 80

# Run nginx in foreground
CMD ["nginx", "-g", "daemon off;"]