FROM ghcr.io/valhalla/valhalla@sha256:dd493671dfebedd6bfb8846aea4b0a469e768ceff4155ca35b235e010f414f1e
USER root
WORKDIR /opt/m14
COPY ops/m14/data/caobang.osm.pbf /opt/m14/caobang.osm.pbf
COPY ops/m14/configure.py ops/m14/server.py /opt/m14/
RUN mkdir -p /opt/m14/tiles && python3 configure.py && valhalla_build_tiles -c /opt/m14/valhalla.json -j 1 /opt/m14/caobang.osm.pbf && rm /opt/m14/caobang.osm.pbf && chmod -R a+rX /opt/m14
ENV PORT=10000 PYTHONUNBUFFERED=1
EXPOSE 10000
USER 65534:65534
ENTRYPOINT ["python3", "/opt/m14/server.py"]
