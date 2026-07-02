pipeline {
    agent any

    options {
        timestamps()
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '20'))
    }

    parameters {
        choice(
            name: 'TARGET_ENV',
            choices: ['auto', 'dev', 'production'],
            description: '目标环境；auto 将按分支自动推断'
        )
        booleanParam(
            name: 'SKIP_TESTS',
            defaultValue: false,
            description: '跳过测试（紧急修复时使用）'
        )
        booleanParam(
            name: 'FORCE_DEPLOY',
            defaultValue: false,
            description: '强制部署（忽略分支守卫）'
        )
        string(
            name: 'LINKSCOPE_ENV_CREDENTIAL_ID_OVERRIDE',
            defaultValue: '',
            description: '可选：临时覆盖 Secret File 凭据 ID'
        )
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('LoadConfig') {
            steps {
                script {
                    def text = readFile(encoding: 'UTF-8', file: 'jenkins.properties')
                    def props = [:]
                    text.split('\n').each { raw ->
                        def line = raw.trim()
                        if (!line || line.startsWith('#')) return
                        def idx = line.indexOf('=')
                        if (idx > 0) {
                            props[line.substring(0, idx).trim()] = line.substring(idx + 1).trim()
                        }
                    }

                    env.ALLOWED_BRANCHES            = (props.get('ALLOWED_BRANCHES') ?: 'develop,stg,main').toString()
                    env.LINKSCOPE_ENV_CREDENTIAL_ID = props.LINKSCOPE_ENV_CREDENTIAL_ID ?: 'linkscope-env-prod'
                    env.COMPOSE_PROJECT_NAME        = props.COMPOSE_PROJECT_NAME ?: 'linkscope'
                    env.WEB_CONTAINER_NAME          = props.WEB_CONTAINER_NAME ?: 'linkscope-web'
                    env.API_CONTAINER_NAME          = props.API_CONTAINER_NAME ?: 'linkscope-api'
                    env.POSTGRES_CONTAINER_NAME     = props.POSTGRES_CONTAINER_NAME ?: 'linkscope-postgres'
                    env.REDIS_CONTAINER_NAME        = props.REDIS_CONTAINER_NAME ?: 'linkscope-redis'
                    env.WEB_HOST_PORT               = props.WEB_HOST_PORT ?: '3000'
                    env.API_HOST_PORT               = props.API_HOST_PORT ?: '3001'

                    if ((params.LINKSCOPE_ENV_CREDENTIAL_ID_OVERRIDE ?: '').trim()) {
                        env.LINKSCOPE_ENV_CREDENTIAL_ID = params.LINKSCOPE_ENV_CREDENTIAL_ID_OVERRIDE.trim()
                    }

                    env.SKIP_PIPELINE = 'false'
                    echo "CONFIG: composeProject=${env.COMPOSE_PROJECT_NAME}, webPort=${env.WEB_HOST_PORT}, apiPort=${env.API_HOST_PORT}, envCred=${env.LINKSCOPE_ENV_CREDENTIAL_ID}"
                }
            }
        }

        stage('BranchGuard') {
            when {
                expression { !params.FORCE_DEPLOY }
            }
            steps {
                script {
                    def rawBranch = (env.BRANCH_NAME ?: env.GIT_BRANCH ?: '').toString()
                    def branch = rawBranch.replaceAll('^origin/', '').replaceAll('^refs/heads/', '')
                    def allowed = env.ALLOWED_BRANCHES.split(',').collect { it.trim() }.findAll { it }

                    if (!branch || !allowed.contains(branch)) {
                        echo "BranchGuard: 分支 [${branch}] 不在允许列表 ${allowed}，跳过构建。"
                        env.SKIP_PIPELINE = 'true'
                        currentBuild.result = 'NOT_BUILT'
                        return
                    }
                    echo "BranchGuard: 分支 [${branch}] 允许，继续执行。"
                }
            }
        }

        stage('ResolveEnv') {
            when {
                expression { env.SKIP_PIPELINE != 'true' }
            }
            steps {
                script {
                    def branch = (env.BRANCH_NAME ?: env.GIT_BRANCH ?: '').toString()
                        .replaceAll('^origin/', '').replaceAll('^refs/heads/', '')
                    def effectiveEnv = params.TARGET_ENV
                    if (effectiveEnv == 'auto') {
                        if (branch ==~ /.*main.*/) { effectiveEnv = 'production' }
                        else if (branch ==~ /.*stg.*/) { effectiveEnv = 'production' }
                        else { effectiveEnv = 'dev' }
                    }
                    env.EFFECTIVE_ENV = effectiveEnv
                    echo "ENV: branch=${branch}, effectiveEnv=${env.EFFECTIVE_ENV}"
                }
            }
        }

        stage('InstallAndTest') {
            when {
                allOf {
                    expression { env.SKIP_PIPELINE != 'true' }
                    expression { !params.SKIP_TESTS }
                }
            }
            steps {
                script {
                    docker.image('node:22-alpine').inside('-v /root/.npm:/root/.npm') {
                        sh '''
                            set -euxo pipefail
                            npm install -g pnpm
                            pnpm install --frozen-lockfile
                            pnpm --filter @linkscope/shared build
                            pnpm --filter @linkscope/api typecheck
                            pnpm --filter @linkscope/web typecheck
                        '''
                    }
                }
            }
        }

        stage('Deploy') {
            when {
                expression { env.SKIP_PIPELINE != 'true' }
            }
            steps {
                withCredentials([
                    file(credentialsId: env.LINKSCOPE_ENV_CREDENTIAL_ID, variable: 'LINKSCOPE_ENV_FILE')
                ]) {
                    sh '''
                        set -euxo pipefail

                        cp "${LINKSCOPE_ENV_FILE}" .env.production

                        grep -q '^WEB_HOST_PORT=' .env.production || echo "WEB_HOST_PORT=${WEB_HOST_PORT}" >> .env.production
                        grep -q '^API_HOST_PORT=' .env.production || echo "API_HOST_PORT=${API_HOST_PORT}" >> .env.production
                        grep -q '^COMPOSE_PROJECT_NAME=' .env.production || echo "COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME}" >> .env.production
                        grep -q '^WEB_CONTAINER_NAME=' .env.production || echo "WEB_CONTAINER_NAME=${WEB_CONTAINER_NAME}" >> .env.production
                        grep -q '^API_CONTAINER_NAME=' .env.production || echo "API_CONTAINER_NAME=${API_CONTAINER_NAME}" >> .env.production
                        grep -q '^POSTGRES_CONTAINER_NAME=' .env.production || echo "POSTGRES_CONTAINER_NAME=${POSTGRES_CONTAINER_NAME}" >> .env.production
                        grep -q '^REDIS_CONTAINER_NAME=' .env.production || echo "REDIS_CONTAINER_NAME=${REDIS_CONTAINER_NAME}" >> .env.production

                        if docker compose version >/dev/null 2>&1; then
                          docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
                          docker compose -f docker-compose.prod.yml --env-file .env.production ps || true
                        elif command -v docker-compose >/dev/null 2>&1; then
                          docker-compose -f docker-compose.prod.yml --env-file .env.production up -d --build
                          docker-compose -f docker-compose.prod.yml --env-file .env.production ps || true
                        else
                          echo "未检测到 docker compose / docker-compose"
                          exit 1
                        fi
                    '''
                }
            }
        }

        stage('HealthCheck') {
            when {
                expression { env.SKIP_PIPELINE != 'true' }
            }
            steps {
                sh '''
                    set -euxo pipefail
                    READY=0
                    for i in $(seq 1 30); do
                      HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
                        "http://localhost:${API_HOST_PORT}/api/tasks" 2>/dev/null || echo "000")
                      if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "404" ]; then
                        READY=1
                        break
                      fi
                      sleep 2
                    done
                    if [ "$READY" != "1" ]; then
                      echo "API 健康检查失败，未在超时时间内可访问"
                      exit 1
                    fi
                    curl -sS --max-time 5 "http://localhost:${WEB_HOST_PORT}" >/dev/null
                '''
            }
        }
    }

    post {
        success {
            echo "LinkScope 发布成功: http://localhost:${env.WEB_HOST_PORT}"
        }
        cleanup {
            echo 'Pipeline 结束。'
        }
    }
}
