# Authorization

## Skaffold

The Kubernetes manifests under [infra/](./infra) reference the `team2-etl` and `team2-scraper` images. For remote or shared clusters, [skaffold.yaml](./skaffold.yaml) is configured to push images so the cluster can pull the generated tag.

Example:

```bash
skaffold run --default-repo <your-registry>
```

For common local clusters (`docker-desktop`, `minikube`, and `kind-kind`), the `local-cluster` profile is auto-activated and keeps image pushes disabled so local development still works with the node's local image store.