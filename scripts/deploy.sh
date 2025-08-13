#!/bin/bash

# MCP WebScraper Deployment Script
# Supports multiple deployment targets: docker, k8s, npm

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VERSION=$(node -p "require('$PROJECT_ROOT/package.json').version")

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Display usage
usage() {
    cat << EOF
Usage: $0 [OPTIONS] TARGET

Deploy MCP WebScraper to different environments.

TARGETS:
    docker      Build and run Docker containers
    k8s         Deploy to Kubernetes cluster
    npm         Publish to NPM registry
    test        Run deployment tests
    clean       Clean up deployment artifacts

OPTIONS:
    -e, --env ENV       Environment (dev, prod, staging)
    -v, --version VER   Override version number
    -h, --help          Show this help message
    --dry-run          Show what would be deployed without executing
    --skip-tests       Skip running tests before deployment

EXAMPLES:
    $0 docker -e prod
    $0 k8s --env staging
    $0 npm --dry-run
    $0 test
EOF
}

# Parse command line arguments
parse_args() {
    ENV="prod"
    DRY_RUN=false
    SKIP_TESTS=false
    
    while [[ $# -gt 0 ]]; do
        case $1 in
            -e|--env)
                ENV="$2"
                shift 2
                ;;
            -v|--version)
                VERSION="$2"
                shift 2
                ;;
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            --skip-tests)
                SKIP_TESTS=true
                shift
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            docker|k8s|npm|test|clean)
                TARGET="$1"
                shift
                ;;
            *)
                log_error "Unknown option: $1"
                usage
                exit 1
                ;;
        esac
    done
    
    if [[ -z "$TARGET" ]]; then
        log_error "Target not specified"
        usage
        exit 1
    fi
}

# Validate environment
validate_environment() {
    log_info "Validating environment..."
    
    # Check if we're in the project root
    if [[ ! -f "$PROJECT_ROOT/package.json" ]]; then
        log_error "package.json not found. Are you in the project root?"
        exit 1
    fi
    
    # Check Node.js version
    NODE_VERSION=$(node --version | cut -d'v' -f2)
    REQUIRED_NODE="18.0.0"
    
    if ! command -v node &> /dev/null; then
        log_error "Node.js not found. Please install Node.js >= $REQUIRED_NODE"
        exit 1
    fi
    
    # Validate environment name
    case $ENV in
        dev|prod|staging|test)
            ;;
        *)
            log_error "Invalid environment: $ENV. Must be one of: dev, prod, staging, test"
            exit 1
            ;;
    esac
    
    log_success "Environment validation passed"
}

# Run tests
run_tests() {
    if [[ "$SKIP_TESTS" == true ]]; then
        log_warning "Skipping tests as requested"
        return 0
    fi
    
    log_info "Running tests..."
    
    cd "$PROJECT_ROOT"
    
    # Install dependencies if needed
    if [[ ! -d "node_modules" ]]; then
        log_info "Installing dependencies..."
        npm ci
    fi
    
    # Run test suite
    npm test
    npm run test:performance:quick
    
    log_success "All tests passed"
}

# Docker deployment
deploy_docker() {
    log_info "Deploying with Docker (env: $ENV)..."
    
    cd "$PROJECT_ROOT"
    
    if [[ "$DRY_RUN" == true ]]; then
        log_info "DRY RUN: Would build Docker image with tag mcp-webscraper:$VERSION"
        log_info "DRY RUN: Would start container with environment $ENV"
        return 0
    fi
    
    # Build Docker image
    log_info "Building Docker image..."
    docker build --target production -t "mcp-webscraper:$VERSION" .
    docker tag "mcp-webscraper:$VERSION" "mcp-webscraper:latest"
    
    # Stop existing container if running
    if docker ps -q --filter "name=mcp-webscraper-$ENV" | grep -q .; then
        log_info "Stopping existing container..."
        docker stop "mcp-webscraper-$ENV"
        docker rm "mcp-webscraper-$ENV"
    fi
    
    # Start new container
    case $ENV in
        dev)
            docker-compose up -d mcp-webscraper-dev
            ;;
        prod)
            docker-compose up -d mcp-webscraper-prod
            ;;
        staging)
            # Use production configuration but with staging settings
            docker run -d \
                --name "mcp-webscraper-$ENV" \
                --restart unless-stopped \
                -e NODE_ENV=staging \
                -e LOG_LEVEL=info \
                -e MAX_WORKERS=5 \
                -e QUEUE_CONCURRENCY=5 \
                -v "mcp-cache-$ENV:/app/cache" \
                -v "mcp-logs-$ENV:/app/logs" \
                -p "300$ENV:3000" \
                "mcp-webscraper:$VERSION"
            ;;
    esac
    
    # Wait for container to be ready
    log_info "Waiting for container to be ready..."
    sleep 10
    
    # Health check
    if docker exec "mcp-webscraper-$ENV" node -e "console.log('Health check passed')" 2>/dev/null; then
        log_success "Docker deployment successful!"
        log_info "Container: mcp-webscraper-$ENV"
        log_info "Version: $VERSION"
        log_info "Environment: $ENV"
    else
        log_error "Health check failed"
        docker logs "mcp-webscraper-$ENV"
        exit 1
    fi
}

# Kubernetes deployment
deploy_k8s() {
    log_info "Deploying to Kubernetes (env: $ENV)..."
    
    # Check if kubectl is available
    if ! command -v kubectl &> /dev/null; then
        log_error "kubectl not found. Please install kubectl to deploy to Kubernetes"
        exit 1
    fi
    
    # Check if we can connect to the cluster
    if ! kubectl cluster-info &> /dev/null; then
        log_error "Cannot connect to Kubernetes cluster"
        exit 1
    fi
    
    cd "$PROJECT_ROOT"
    
    if [[ "$DRY_RUN" == true ]]; then
        log_info "DRY RUN: Would deploy to Kubernetes cluster"
        log_info "DRY RUN: Would use image mcp-webscraper:$VERSION"
        log_info "DRY RUN: Would deploy to namespace: mcp-webscraper-$ENV"
        return 0
    fi
    
    # Create namespace if it doesn't exist
    kubectl create namespace "mcp-webscraper-$ENV" --dry-run=client -o yaml | kubectl apply -f -
    
    # Generate Kubernetes manifests
    cat << EOF > k8s-deployment-$ENV.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mcp-webscraper
  namespace: mcp-webscraper-$ENV
spec:
  replicas: $([ "$ENV" = "prod" ] && echo 3 || echo 1)
  selector:
    matchLabels:
      app: mcp-webscraper
  template:
    metadata:
      labels:
        app: mcp-webscraper
    spec:
      containers:
      - name: mcp-webscraper
        image: mcp-webscraper:$VERSION
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: $ENV
        - name: LOG_LEVEL
          value: info
        resources:
          requests:
            memory: "512Mi"
            cpu: "0.5"
          limits:
            memory: "1Gi"
            cpu: "1.0"
---
apiVersion: v1
kind: Service
metadata:
  name: mcp-webscraper-service
  namespace: mcp-webscraper-$ENV
spec:
  selector:
    app: mcp-webscraper
  ports:
  - protocol: TCP
    port: 80
    targetPort: 3000
  type: LoadBalancer
EOF
    
    # Apply manifests
    kubectl apply -f "k8s-deployment-$ENV.yaml"
    
    # Wait for deployment to be ready
    log_info "Waiting for deployment to be ready..."
    kubectl wait --for=condition=available --timeout=300s deployment/mcp-webscraper -n "mcp-webscraper-$ENV"
    
    # Get service information
    kubectl get service mcp-webscraper-service -n "mcp-webscraper-$ENV"
    
    log_success "Kubernetes deployment successful!"
    log_info "Namespace: mcp-webscraper-$ENV"
    log_info "Version: $VERSION"
    
    # Clean up temporary files
    rm -f "k8s-deployment-$ENV.yaml"
}

# NPM deployment
deploy_npm() {
    log_info "Publishing to NPM registry..."
    
    cd "$PROJECT_ROOT"
    
    # Check if user is logged in to NPM
    if ! npm whoami &> /dev/null; then
        log_error "Not logged in to NPM. Run 'npm login' first"
        exit 1
    fi
    
    if [[ "$DRY_RUN" == true ]]; then
        log_info "DRY RUN: Would publish version $VERSION to NPM"
        npm publish --dry-run
        return 0
    fi
    
    # Update version if specified
    if [[ "$VERSION" != "$(node -p "require('./package.json').version")" ]]; then
        log_info "Updating version to $VERSION"
        npm version "$VERSION" --no-git-tag-version
    fi
    
    # Publish to NPM
    npm publish --access public
    
    log_success "NPM publication successful!"
    log_info "Package: mcp-webscraper@$VERSION"
    log_info "Registry: https://www.npmjs.com/package/mcp-webscraper"
}

# Run deployment tests
run_deployment_tests() {
    log_info "Running deployment tests..."
    
    cd "$PROJECT_ROOT"
    
    # Test Docker deployment
    log_info "Testing Docker deployment..."
    if docker run --rm "mcp-webscraper:latest" npm test; then
        log_success "Docker tests passed"
    else
        log_error "Docker tests failed"
        exit 1
    fi
    
    # Test NPM package
    log_info "Testing NPM package..."
    TEST_DIR=$(mktemp -d)
    cd "$TEST_DIR"
    
    if npm install "mcp-webscraper@$VERSION" && node -e "require('mcp-webscraper')"; then
        log_success "NPM package tests passed"
    else
        log_error "NPM package tests failed"
        exit 1
    fi
    
    # Cleanup
    rm -rf "$TEST_DIR"
    
    log_success "All deployment tests passed!"
}

# Clean up deployment artifacts
clean_deployment() {
    log_info "Cleaning up deployment artifacts..."
    
    cd "$PROJECT_ROOT"
    
    if [[ "$DRY_RUN" == true ]]; then
        log_info "DRY RUN: Would clean Docker images and containers"
        log_info "DRY RUN: Would clean Kubernetes resources"
        return 0
    fi
    
    # Clean Docker resources
    log_info "Cleaning Docker resources..."
    docker system prune -f
    
    # Remove old images
    docker images "mcp-webscraper" --format "table {{.Repository}}:{{.Tag}}" | grep -v "latest" | grep -v "REPOSITORY" | xargs -r docker rmi
    
    # Clean Kubernetes resources (optional)
    if command -v kubectl &> /dev/null; then
        log_info "Cleaning Kubernetes test resources..."
        kubectl delete namespace mcp-webscraper-test --ignore-not-found=true
    fi
    
    log_success "Cleanup completed!"
}

# Main execution
main() {
    parse_args "$@"
    
    log_info "Starting deployment process..."
    log_info "Target: $TARGET"
    log_info "Environment: $ENV"
    log_info "Version: $VERSION"
    log_info "Dry run: $DRY_RUN"
    
    validate_environment
    
    case $TARGET in
        docker)
            run_tests
            deploy_docker
            ;;
        k8s)
            run_tests
            deploy_k8s
            ;;
        npm)
            run_tests
            deploy_npm
            ;;
        test)
            run_deployment_tests
            ;;
        clean)
            clean_deployment
            ;;
        *)
            log_error "Unknown target: $TARGET"
            usage
            exit 1
            ;;
    esac
    
    log_success "Deployment process completed successfully!"
}

# Execute main function with all arguments
main "$@"