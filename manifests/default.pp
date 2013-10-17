# Update packages list before attempting to install any
exec {
  'apt-get update':
    command => '/usr/bin/apt-get update';
}
Exec['apt-get update'] -> Package <| |>

# Add archive for Node.js before attempting to install it
exec {
  'add-apt node':
    command => 'add-apt-repository ppa:chris-lea/node.js && apt-get update',
    path => [ '/usr/bin', '/bin' ],
    require => Package['python-software-properties'],
    creates => '/etc/apt/sources.list.d/chris-lea-node_js-precise.list';
}
Exec['add-apt node'] -> Package['nodejs']

# Install packages
package {
  [ 'git', 'g++', 'make', 'nodejs', 'openjdk-7-jdk', 'python-software-properties', 'vim' ]:
    ensure => 'installed';
}
