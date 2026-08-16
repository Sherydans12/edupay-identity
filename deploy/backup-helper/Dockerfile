FROM postgres@sha256:cf7f8fb958c63e62875e30645dc4819ff0243a923f3c709e752b99dedd40bfcd

LABEL org.opencontainers.image.title="EduPay PostgreSQL 15 backup helper" \
      org.opencontainers.image.description="Minimal PostgreSQL 15.19, AWS CLI, and archive helper for EduPay operational backups" \
      org.opencontainers.image.source="https://github.com/Sherydans12/edupay-identity"

USER root

RUN apt-get update \
    && apt-get install -y --no-install-recommends awscli ca-certificates tar \
    && rm -rf /var/lib/apt/lists/*

CMD ["/bin/bash"]
