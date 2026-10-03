# Test IANSEO (PHP + Apache) to develop the module
FROM php:8.2-apache
RUN apt-get update && apt-get install -y --no-install-recommends libzip-dev libpng-dev libjpeg-dev libfreetype6-dev mariadb-client \
 && docker-php-ext-configure gd --with-freetype --with-jpeg \
 && docker-php-ext-install mysqli zip gd \
 && rm -rf /var/lib/apt/lists/*
RUN echo "memory_limit=512M\nupload_max_filesize=20M\npost_max_size=20M\nmax_execution_time=120" > /usr/local/etc/php/conf.d/ianseo.ini
